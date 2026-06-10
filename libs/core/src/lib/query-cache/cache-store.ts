import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { queryCacheDbPath } from './cache-layout';

/** Default absolute time-to-live for a {@link CachedResult}: one hour (ADR-0054). */
export const DEFAULT_QUERY_CACHE_TTL_MS = 60 * 60 * 1000;

/** Default global byte budget for the whole Query cache: 256 MiB (ADR-0054). */
export const DEFAULT_QUERY_CACHE_MAX_BYTES = 256 * 1024 * 1024;

/** Default per-entry ceiling: a body over 32 MiB bypasses the cache (ADR-0054). */
export const DEFAULT_QUERY_CACHE_MAX_ENTRY_BYTES = 32 * 1024 * 1024;

/** One Query cache entry as returned to a reader. */
export interface CachedResult {
  body: string;
  format: string;
  contentType: string;
}

/** Serialization metadata stored alongside a body on {@link QueryCache.set}. */
export interface QueryCacheSetMeta {
  format: string;
  contentType: string;
  /** The owning {@link target source}'s id — used for the per-source byte cap. */
  sourceId: string;
  /**
   * This source's optional per-source byte cap. A number bounds the source's
   * footprint independently of the global pool; `null` is explicitly unbounded;
   * `undefined` leaves the source governed by the global budget alone.
   */
  sourceMaxBytes?: number | null;
}

/**
 * The Cache store's public surface (ADR-0054). A deep module: callers see only
 * `get`/`set`/`close`; the SQLite backend, the schema-version stamp, and the
 * lazy absolute-TTL sweep are hidden behind it.
 */
export interface QueryCache {
  /**
   * The stored body for `key`, or `undefined` for a miss. An entry whose age has
   * passed the TTL is a miss and is purged in passing (on-read self-heal).
   */
  get(key: string): CachedResult | undefined;
  /** Stores (or replaces) the body for `key`, stamped with the current time. */
  set(key: string, body: string, meta: QueryCacheSetMeta): void;
  close(): void;
}

export interface OpenQueryCacheOptions {
  /** The Query cache directory (`<configDir>/.sparqly/cache/`). */
  dir: string;
  /** Cache-schema version; a stored stamp that differs wipes the store on open. */
  schemaVersion: string;
  /** Absolute time-to-live in milliseconds, measured from insertion. */
  ttlMs: number;
  /**
   * Global byte budget for the whole store. A number evicts least-recently-
   * accessed entries on write until total bytes fit; `null` is explicitly
   * unbounded (no global eviction) and warns on open; omitted defaults to
   * {@link DEFAULT_QUERY_CACHE_MAX_BYTES}.
   */
  maxBytes?: number | null;
  /**
   * Per-entry ceiling; a body whose byte length exceeds this bypasses the cache
   * (executed, not stored). Defaults to {@link DEFAULT_QUERY_CACHE_MAX_ENTRY_BYTES}.
   */
  maxEntryBytes?: number;
  /** Injectable clock (ms epoch) for deterministic TTL tests; defaults to `Date.now`. */
  now?: () => number;
  /** Sink for the unbounded-budget warning emitted at open; defaults to silence. */
  logger?: { warn(message: string, meta?: unknown): void };
}

const ENTRIES_DDL = `
  CREATE TABLE IF NOT EXISTS entries (
    key            TEXT PRIMARY KEY,
    body           TEXT NOT NULL,
    format         TEXT NOT NULL,
    content_type   TEXT NOT NULL,
    source_id      TEXT NOT NULL,
    bytes          INTEGER NOT NULL,
    inserted_at    INTEGER NOT NULL,
    last_access_at INTEGER NOT NULL
  ) WITHOUT ROWID;
`;

const META_DDL = `
  CREATE TABLE IF NOT EXISTS cache_meta (
    name  TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

/**
 * Opens (creating if absent) the on-disk Query cache. On open it checks the
 * stored cache-schema version against {@link OpenQueryCacheOptions.schemaVersion}
 * and, on a mismatch, wipes and rebuilds the store — so a sparqly upgrade that
 * changes serialization can never serve a wrong cached body.
 */
export function openQueryCache(options: OpenQueryCacheOptions): QueryCache {
  const now = options.now ?? Date.now;
  const maxBytes =
    options.maxBytes === undefined
      ? DEFAULT_QUERY_CACHE_MAX_BYTES
      : options.maxBytes;
  const maxEntryBytes =
    options.maxEntryBytes ?? DEFAULT_QUERY_CACHE_MAX_ENTRY_BYTES;
  mkdirSync(options.dir, { recursive: true });
  const db = new Database(queryCacheDbPath(options.dir));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(META_DDL);
  db.exec(ENTRIES_DDL);
  enforceSchemaVersion(db, options.schemaVersion);

  if (maxBytes === null) {
    options.logger?.warn(
      'Query cache opened with an explicitly unbounded byte budget (queryCache.maxBytes: null); it can grow without limit.',
    );
  }

  const selectStmt = db.prepare(
    'SELECT body, format, content_type AS contentType, inserted_at AS insertedAt FROM entries WHERE key = ?',
  );
  const touchStmt = db.prepare(
    'UPDATE entries SET last_access_at = ? WHERE key = ?',
  );
  const upsertStmt = db.prepare(
    `INSERT INTO entries (key, body, format, content_type, source_id, bytes, inserted_at, last_access_at)
     VALUES (@key, @body, @format, @contentType, @sourceId, @bytes, @at, @at)
     ON CONFLICT(key) DO UPDATE SET
       body = excluded.body,
       format = excluded.format,
       content_type = excluded.content_type,
       source_id = excluded.source_id,
       bytes = excluded.bytes,
       inserted_at = excluded.inserted_at,
       last_access_at = excluded.last_access_at`,
  );
  const deleteStmt = db.prepare('DELETE FROM entries WHERE key = ?');
  const purgeExpiredStmt = db.prepare(
    'DELETE FROM entries WHERE ? - inserted_at > ?',
  );
  const totalBytesStmt = db.prepare(
    'SELECT COALESCE(SUM(bytes), 0) AS total FROM entries',
  );
  // The single least-recently-accessed key, ties broken by key for determinism.
  const oldestKeyStmt = db.prepare(
    'SELECT key FROM entries ORDER BY last_access_at ASC, key ASC LIMIT 1',
  );
  const sourceBytesStmt = db.prepare(
    'SELECT COALESCE(SUM(bytes), 0) AS total FROM entries WHERE source_id = ?',
  );
  const oldestSourceKeyStmt = db.prepare(
    'SELECT key FROM entries WHERE source_id = ? ORDER BY last_access_at ASC, key ASC LIMIT 1',
  );

  /** Evicts least-recently-accessed entries until total bytes fit `budget`. */
  function evictToGlobalBudget(budget: number): void {
    let total = (totalBytesStmt.get() as { total: number }).total;
    while (total > budget) {
      const victim = oldestKeyStmt.get() as { key: string } | undefined;
      if (victim === undefined) return;
      deleteStmt.run(victim.key);
      total = (totalBytesStmt.get() as { total: number }).total;
    }
  }

  /** Evicts a source's least-recently-accessed entries until it fits `budget`. */
  function evictToSourceBudget(sourceId: string, budget: number): void {
    let total = (sourceBytesStmt.get(sourceId) as { total: number }).total;
    while (total > budget) {
      const victim = oldestSourceKeyStmt.get(sourceId) as
        | { key: string }
        | undefined;
      if (victim === undefined) return;
      deleteStmt.run(victim.key);
      total = (sourceBytesStmt.get(sourceId) as { total: number }).total;
    }
  }

  return {
    get(key: string): CachedResult | undefined {
      const row = selectStmt.get(key) as
        | {
            body: string;
            format: string;
            contentType: string;
            insertedAt: number;
          }
        | undefined;
      if (row === undefined) return undefined;
      if (now() - row.insertedAt > options.ttlMs) {
        deleteStmt.run(key);
        return undefined;
      }
      // A read is an access: bump recency so a hit rescues the entry from LRU.
      touchStmt.run(now(), key);
      return {
        body: row.body,
        format: row.format,
        contentType: row.contentType,
      };
    },
    set(key: string, body: string, meta: QueryCacheSetMeta): void {
      const bytes = Buffer.byteLength(body, 'utf8');
      // A body over the per-entry ceiling bypasses the cache (no error).
      if (bytes > maxEntryBytes) return;
      // Sweep expired rows first so their bytes don't count against the budget.
      purgeExpiredStmt.run(now(), options.ttlMs);
      upsertStmt.run({
        key,
        body,
        format: meta.format,
        contentType: meta.contentType,
        sourceId: meta.sourceId,
        bytes,
        at: now(),
      });
      // Per-source cap first (bounds this source on its own), then the global
      // pool — so a chatty cheap source cannot crowd out an expensive one.
      if (typeof meta.sourceMaxBytes === 'number') {
        evictToSourceBudget(meta.sourceId, meta.sourceMaxBytes);
      }
      if (maxBytes !== null) evictToGlobalBudget(maxBytes);
    },
    close(): void {
      db.close();
    },
  };
}

const SCHEMA_VERSION_KEY = 'schema_version';

function enforceSchemaVersion(
  db: Database.Database,
  schemaVersion: string,
): void {
  const row = db
    .prepare('SELECT value FROM cache_meta WHERE name = ?')
    .get(SCHEMA_VERSION_KEY) as { value: string } | undefined;
  if (row !== undefined && row.value === schemaVersion) return;
  if (row !== undefined) {
    // A stamp exists but differs: wipe every entry so no stale-serialization
    // body can survive an upgrade.
    db.exec('DELETE FROM entries');
  }
  db.prepare(
    'INSERT INTO cache_meta (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value',
  ).run(SCHEMA_VERSION_KEY, schemaVersion);
}
