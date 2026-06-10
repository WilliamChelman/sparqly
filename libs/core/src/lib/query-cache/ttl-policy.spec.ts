import { describe, expect, it } from 'vitest';
import { DEFAULT_QUERY_CACHE_TTL_MS } from './cache-store';
import { resolveQueryCacheTtlMs } from './ttl-policy';

/**
 * The Query cache's one TTL policy knob (ADR-0054, #416): a per-source `ttl`
 * overrides the global default, and an absent override falls back to it. Pure —
 * it just expresses the precedence.
 */
describe('resolveQueryCacheTtlMs', () => {
  it('uses the per-source override when present', () => {
    expect(resolveQueryCacheTtlMs(30 * 60 * 1000, 60 * 60 * 1000)).toBe(
      30 * 60 * 1000,
    );
  });

  it('falls back to the given global default when no override', () => {
    expect(resolveQueryCacheTtlMs(undefined, 60 * 60 * 1000)).toBe(
      60 * 60 * 1000,
    );
  });

  it('falls back to the 1h default when neither is given', () => {
    expect(resolveQueryCacheTtlMs(undefined)).toBe(DEFAULT_QUERY_CACHE_TTL_MS);
  });
});
