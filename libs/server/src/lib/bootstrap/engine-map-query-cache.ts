import type { SparqlyLogger } from 'common';
import {
  cacheSourceId,
  DEFAULT_QUERY_CACHE_TTL_MS,
  digestContext,
  freshnessFactsAreStable,
  freshnessTokenFromFacts,
  openQueryCache,
  queryCacheDir,
  sourceQueryCacheOptIn,
  wrapWithQueryCache,
  type FreshnessFacts,
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
  /**
   * Memoizes the freshness token per loaded generation (ADR-0054), but **only**
   * for sources whose token is invariant for that generation's lifetime
   * (`freshnessFactsAreStable`): pass-through, disk-backed, and *pinned*
   * materialized. `ensure` runs {@link wrap} on every request, so reusing a
   * stable token within a generation avoids re-reading a manifest / re-hashing
   * paths on a sub-millisecond hit. Each (re)load builds a fresh
   * {@link LoadedSources} object (see `loadEntry`/`loadEntryViaWorker`), so keying
   * on its reference recomputes after a reload — and the WeakMap lets the stale
   * generation's entry be collected.
   *
   * An *unpinned* materialized source is deliberately excluded: its stat-digest
   * moves on an on-disk edit with no reload, so its token MUST be recomputed per
   * request — that per-request stat is #415's content-aware invalidation, and
   * memoizing it would serve stale content.
   */
  private readonly freshnessTokens = new WeakMap<
    LoadedSources,
    Promise<string>
  >();

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
    return wrapWithQueryCache({
      engine,
      queryCache,
      sourceId: cacheSourceId(source),
      schemaVersion: this.schemaVersion,
      // `serve` serializes without project prefixes/base today, so the display
      // context is empty here; a later slice threads it through if that changes.
      contextDigest: digestContext({}),
      mode: 'normal',
      // The token is memoized per loaded generation (see `freshnessToken`), so a
      // sub-millisecond hit doesn't restat every matched file on each request.
      freshnessToken: () =>
        this.freshnessToken(source, loadedSources, files),
      openCache: () => this.store(),
      logger: this.logger,
    });
  }

  /**
   * The freshness token for a request. A *stable* fact-set (pass-through,
   * disk-backed, or pinned materialized) is computed once per
   * {@link LoadedSources} object and reused across requests until a reload swaps
   * in a fresh object; a rejected computation is evicted so a transient failure
   * (e.g. a stat error) self-heals on the next request. An *unstable* fact-set
   * (unpinned materialized) is recomputed every request so an on-disk edit is
   * detected without a reload (ADR-0054, #415) — it is never memoized.
   */
  private freshnessToken(
    source: ParsedSource,
    loadedSources: LoadedSources,
    files: ReadonlyArray<string>,
  ): Promise<string> {
    const facts = serveFreshnessFacts(source, loadedSources, files);
    if (!freshnessFactsAreStable(facts)) return freshnessTokenFromFacts(facts);
    const memoized = this.freshnessTokens.get(loadedSources);
    if (memoized !== undefined) return memoized;
    const computed = freshnessTokenFromFacts(facts).catch((err) => {
      this.freshnessTokens.delete(loadedSources);
      throw err;
    });
    this.freshnessTokens.set(loadedSources, computed);
    return computed;
  }

  /**
   * Empties the store — the `cache clear` admin action (ADR-0054, #418).
   * Opens the store when this process hasn't touched it yet: entries persisted
   * by a prior run live on disk and must clear too.
   */
  clear(): void {
    this.store().clear();
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
 * Projects the `serve` shapes (`ParsedSource` + `LoadedSources` + matched files)
 * onto the shared {@link FreshnessFacts} (ADR-0054, #415) — the single source of
 * truth shared with the CLI (`freshnessTokenFor`) so serve and CLI can't drift.
 * Keeping the projection pure (no I/O) lets {@link ServeQueryCache.freshnessToken}
 * decide memoizability via `freshnessFactsAreStable` before paying for the token:
 * - endpoint → pass-through (TTL-bounded, empty token).
 * - disk-backed → the on-disk index manifest.
 * - pinned glob/file (resolved SHA on the source) → that SHA + path set.
 * - otherwise materialized → a stat-digest of the matched files.
 *
 * A plain `gitRef` glob without a stamped `resolvedSha` falls back to the
 * stat-digest, which is conservative (a working-tree edit recomputes) and never
 * serves stale content. Worker-loaded (ADR-0050) entries project identically.
 */
function serveFreshnessFacts(
  source: ParsedSource,
  loadedSources: LoadedSources,
  files: ReadonlyArray<string>,
): FreshnessFacts {
  if (loadedSources.mode === 'pass-through') return { mode: 'pass-through' };
  if (loadedSources.mode === 'disk-backed') {
    return { mode: 'disk-backed', indexDir: loadedSources.indexDir };
  }
  const resolvedSha =
    source.kind === 'glob' || source.kind === 'file'
      ? source.resolvedSha
      : undefined;
  return { mode: 'materialized', resolvedSha, files };
}
