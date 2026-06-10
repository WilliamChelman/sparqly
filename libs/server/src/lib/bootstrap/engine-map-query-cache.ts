import type { SparqlyLogger } from 'common';
import {
  cacheSourceId,
  CachingQueryExecutor,
  DEFAULT_QUERY_CACHE_TTL_MS,
  digestContext,
  digestFileStats,
  digestGlobIndexManifest,
  pinnedFreshnessToken,
  queryCacheCap,
  queryCacheTtlMs,
  resolveQueryCacheTtlMs,
  openQueryCache,
  queryCacheDir,
  readGlobIndexManifest,
  snapshotIndexedFiles,
  sourceQueryCacheOptIn,
  type ParsedSource,
  type QueryCache,
  type QueryExecutor,
} from 'core';
import type { LoadedSources } from './engine-map-types';

/** The Query cache's global byte budget for a `serve` process (ADR-0054). */
export interface ServeQueryCacheBudget {
  /** Global byte budget; `null` is explicitly unbounded; omitted uses the default. */
  maxBytes?: number | null;
  /** Per-entry ceiling; a larger result bypasses the cache; omitted uses the default. */
  maxEntryBytes?: number;
}

/**
 * The lazily-opened shared Query cache for a `serve` EngineMap (ADR-0054). One
 * on-disk store serves every request; it is created on the first touch of an
 * opted-in source and closed on shutdown. {@link wrap} returns the bare engine
 * untouched for any source that did not opt in, so nothing is created or read.
 */
export class ServeQueryCache {
  private handle: QueryCache | undefined;
  private readonly schemaVersion: string;

  constructor(
    private readonly configDir: string,
    sparqlyVersion: string | undefined,
    private readonly logger: SparqlyLogger | undefined,
    private readonly budget: ServeQueryCacheBudget = {},
  ) {
    this.schemaVersion = sparqlyVersion ?? '0.0.0+unknown';
  }

  /**
   * Wraps an opted-in source's executor; passes everything else through. Covers
   * every resolution path (ADR-0054, #415): an endpoint keys on TTL alone, while
   * a materialized, pinned, or disk-backed source folds a path-aware freshness
   * token into the key so an underlying change recomputes. The token is computed
   * per wrap (per `ensure`) from main-side facts — matched files, the resolved
   * SHA, or the index manifest — so a file edited and reloaded misses. Any failure
   * computing the token returns the bare engine, so the query still runs uncached.
   */
  async wrap(
    source: ParsedSource | undefined,
    engine: QueryExecutor,
    loadedSources: LoadedSources,
    files: ReadonlyArray<string>,
  ): Promise<QueryExecutor> {
    if (source === undefined) return engine;
    const queryCache = sourceQueryCacheOptIn(source);
    if (queryCache === undefined) return engine;
    try {
      const freshnessToken = await serveFreshnessToken(
        source,
        loadedSources,
        files,
      );
      return new CachingQueryExecutor({
        delegate: engine,
        cache: this.store(),
        sourceId: cacheSourceId(source),
        sourceMaxBytes: queryCacheCap(queryCache),
        // `serve` serializes without project prefixes/base today, so the display
        // context is empty here; a later slice threads it through if that changes.
        contextDigest: digestContext({}),
        freshnessToken,
        schemaVersion: this.schemaVersion,
        entryTtlMs: resolveQueryCacheTtlMs(queryCacheTtlMs(queryCache)),
        mode: 'normal',
        logger: this.logger,
      });
    } catch (err) {
      this.logger?.debug('query-cache-disabled', {
        source: cacheSourceId(source),
        reason: err instanceof Error ? err.message : String(err),
      });
      return engine;
    }
  }

  close(): void {
    this.handle?.close();
    this.handle = undefined;
  }

  private store(): QueryCache {
    if (this.handle === undefined) {
      this.handle = openQueryCache({
        dir: queryCacheDir(this.configDir),
        schemaVersion: this.schemaVersion,
        ttlMs: DEFAULT_QUERY_CACHE_TTL_MS,
        maxBytes: this.budget.maxBytes,
        maxEntryBytes: this.budget.maxEntryBytes,
        logger: this.logger,
      });
    }
    return this.handle;
  }
}

/**
 * The path-aware freshness token for a loaded `serve` source (ADR-0054, #415),
 * derived from main-side facts so it works identically for main-thread and
 * worker-loaded (ADR-0050) entries:
 * - endpoint → empty (TTL-bounded).
 * - disk-backed → the on-disk index manifest digest.
 * - pinned glob/file (resolved SHA on the source) → that SHA.
 * - otherwise materialized → a stat-digest of the matched files.
 *
 * A plain `gitRef` glob without a stamped `resolvedSha` falls back to the
 * stat-digest, which is conservative (a working-tree edit recomputes) and never
 * serves stale content.
 */
async function serveFreshnessToken(
  source: ParsedSource,
  loadedSources: LoadedSources,
  files: ReadonlyArray<string>,
): Promise<string> {
  if (loadedSources.mode === 'pass-through') return '';
  if (loadedSources.mode === 'disk-backed') {
    return digestGlobIndexManifest(
      await readGlobIndexManifest(loadedSources.indexDir),
    );
  }
  if (
    (source.kind === 'glob' || source.kind === 'file') &&
    source.resolvedSha !== undefined
  ) {
    return pinnedFreshnessToken(source.resolvedSha);
  }
  return digestFileStats(await snapshotIndexedFiles([...files]));
}
