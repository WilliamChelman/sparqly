import { okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import type { ExecuteResult, QueryExecutor } from '../engine';
import { CachingQueryExecutor } from './caching-query-executor';
import type { QueryCache } from './cache-store';
import { wrapWithQueryCache } from './wrap-with-query-cache';

/**
 * `wrapWithQueryCache` is the shared opt-in → token → store → CachingQueryExecutor
 * recipe behind the CLI (`maybeWithQueryCache`) and `serve`
 * (`ServeQueryCache.wrap`). It folds the per-source cap and TTL out of the parsed
 * opt-in, and — like both call sites always have — falls back to the bare engine
 * (logging `query-cache-disabled`) on any failure computing the token or opening
 * the store, so the query still runs uncached.
 */
describe('wrapWithQueryCache', () => {
  const engine: QueryExecutor = {
    executeResult: () => okAsync({} as ExecuteResult),
  };

  function fakeCache(): QueryCache {
    return {
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
      close: vi.fn(),
    } as unknown as QueryCache;
  }

  it('wraps the engine in a CachingQueryExecutor when the source opted in', async () => {
    const wrapped = await wrapWithQueryCache({
      engine,
      queryCache: true,
      sourceId: 'vocab',
      schemaVersion: '1.0.0',
      contextDigest: 'ctx',
      mode: 'normal',
      freshnessToken: () => Promise.resolve('tok'),
      openCache: fakeCache,
    });
    expect(wrapped).toBeInstanceOf(CachingQueryExecutor);
    expect(wrapped).not.toBe(engine);
  });

  it('returns the bare engine, logging, when the freshness token throws', async () => {
    const logger = { debug: vi.fn() };
    const openCache = vi.fn(fakeCache);
    const wrapped = await wrapWithQueryCache({
      engine,
      queryCache: true,
      sourceId: 'vocab',
      schemaVersion: '1.0.0',
      contextDigest: 'ctx',
      mode: 'normal',
      freshnessToken: () => Promise.reject(new Error('stat boom')),
      openCache,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger: logger as any,
    });
    expect(wrapped).toBe(engine);
    expect(openCache).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'query-cache-disabled',
      expect.objectContaining({ source: 'vocab', reason: 'stat boom' }),
    );
  });

  it('returns the bare engine when opening the store throws', async () => {
    const wrapped = await wrapWithQueryCache({
      engine,
      queryCache: true,
      sourceId: 'vocab',
      schemaVersion: '1.0.0',
      contextDigest: 'ctx',
      mode: 'normal',
      freshnessToken: () => Promise.resolve('tok'),
      openCache: () => {
        throw new Error('open boom');
      },
    });
    expect(wrapped).toBe(engine);
  });
});
