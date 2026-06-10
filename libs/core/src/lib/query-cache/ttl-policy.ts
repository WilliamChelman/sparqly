import { DEFAULT_QUERY_CACHE_TTL_MS } from './cache-store';

/**
 * Resolves a source's effective absolute TTL in milliseconds (ADR-0054, #416):
 * its per-source override when present, otherwise the global default. This is
 * the Query cache's whole TTL policy — per-source beats global, and the global
 * itself defaults to {@link DEFAULT_QUERY_CACHE_TTL_MS} (1h). The resolved value
 * feeds the store's per-entry expiry on `set`.
 */
export function resolveQueryCacheTtlMs(
  perSourceMs: number | undefined,
  globalDefaultMs: number = DEFAULT_QUERY_CACHE_TTL_MS,
): number {
  return perSourceMs ?? globalDefaultMs;
}
