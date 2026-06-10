import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { queryCacheDbPath } from './cache-layout';

/** Default absolute time-to-live for a {@link CachedResult}: one hour (ADR-0054). */
export const DEFAULT_QUERY_CACHE_TTL_MS = 60 * 60 * 1000;

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
  /** Injectable clock (ms epoch) for deterministic TTL tests; defaults to `Date.now`. */
  now?: () => number;
}

const ENTRIES_DDL = `
  CREATE TABLE IF NOT EXISTS entries (
    key          TEXT PRIMARY KEY,
    body         TEXT NOT NULL,
    format       TEXT NOT NULL,
    content_type TEXT NOT NULL,
    inserted_at  INTEGER NOT NULL
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
  mkdirSync(options.dir, { recursive: true });
  const db = new Database(queryCacheDbPath(options.dir));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(META_DDL);
  db.exec(ENTRIES_DDL);
  enforceSchemaVersion(db, options.schemaVersion);

  const selectStmt = db.prepare(
    'SELECT body, format, content_type AS contentType, inserted_at AS insertedAt FROM entries WHERE key = ?',
  );
  const upsertStmt = db.prepare(
    `INSERT INTO entries (key, body, format, content_type, inserted_at)
     VALUES (@key, @body, @format, @contentType, @insertedAt)
     ON CONFLICT(key) DO UPDATE SET
       body = excluded.body,
       format = excluded.format,
       content_type = excluded.content_type,
       inserted_at = excluded.inserted_at`,
  );
  const deleteStmt = db.prepare('DELETE FROM entries WHERE key = ?');

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
      return {
        body: row.body,
        format: row.format,
        contentType: row.contentType,
      };
    },
    set(key: string, body: string, meta: QueryCacheSetMeta): void {
      upsertStmt.run({
        key,
        body,
        format: meta.format,
        contentType: meta.contentType,
        insertedAt: now(),
      });
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
