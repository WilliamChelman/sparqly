import type { SparqlyLogger } from 'common';
import type { CacheMode, QueryExecutor } from '../engine';
import {
  queryCacheCap,
  queryCacheTtlMs,
  type ParsedQueryCache,
} from '../sources/source-spec';
import { CachingQueryExecutor } from './caching-query-executor';
import type { QueryCache } from './cache-store';
import { resolveQueryCacheTtlMs } from './ttl-policy';

/** Inputs to {@link wrapWithQueryCache}; see the function doc for the recipe. */
export interface WrapWithQueryCacheInput {
  /** The bare executor to wrap (and the fallback when wrapping is skipped/fails). */
  engine: QueryExecutor;
  /** The source's resolved opt-in — the cap and TTL are folded out of it here. */
  queryCache: ParsedQueryCache;
  /** The cache-key source id and the per-source cap owner. */
  sourceId: string;
  /** Cache-schema version — a key component. */
  schemaVersion: string;
  /** Digest of the display context (prefixes/base) — a key component. */
  contextDigest: string;
  /** Read-through (`normal`) or replace-on-hit (`refresh`). */
  mode: CacheMode;
  /**
   * Computes the path-aware freshness token (#415). Run inside the guarded
   * region so any failure (e.g. a stat error) falls back to the bare engine.
   */
  freshnessToken: () => Promise<string>;
  /**
   * Resolves the cache store. Run inside the guarded region — a per-invocation
   * open or a memoized shared handle — and only *after* the token succeeds, so a
   * token failure never opens a store. Any throw falls back to the bare engine.
   */
  openCache: () => QueryCache;
  logger?: SparqlyLogger;
}

/**
 * The shared opt-in → token → store → {@link CachingQueryExecutor} recipe behind
 * the CLI (`maybeWithQueryCache`) and `serve` (`ServeQueryCache.wrap`). The
 * caller has already decided the source opted in (and the CLI its `--no-cache`
 * opt-out); this folds the per-source cap and TTL out of the opt-in, computes
 * the freshness token, resolves the store, and builds the caching executor.
 *
 * Both call sites have always shared one failure contract: any error computing
 * the token or resolving the store returns the bare engine — logging
 * `query-cache-disabled` — so the query still runs uncached. The token is
 * computed before the store is touched, so a token failure never opens a store
 * (the CLI relied on this to leave the cache directory untouched on failure).
 */
export async function wrapWithQueryCache(
  input: WrapWithQueryCacheInput,
): Promise<QueryExecutor> {
  const {
    engine,
    queryCache,
    sourceId,
    schemaVersion,
    contextDigest,
    mode,
    freshnessToken,
    openCache,
    logger,
  } = input;
  try {
    const token = await freshnessToken();
    return new CachingQueryExecutor({
      delegate: engine,
      cache: openCache(),
      sourceId,
      sourceMaxBytes: queryCacheCap(queryCache),
      contextDigest,
      freshnessToken: token,
      schemaVersion,
      entryTtlMs: resolveQueryCacheTtlMs(queryCacheTtlMs(queryCache)),
      mode,
      logger,
    });
  } catch (err) {
    logger?.debug('query-cache-disabled', {
      source: sourceId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return engine;
  }
}
