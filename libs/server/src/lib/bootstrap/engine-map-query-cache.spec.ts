import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Count every `stat` the freshness-token path performs. `snapshotIndexedFiles`
// stats each matched file, so the call count is a faithful proxy for the I/O
// storm the cache is meant to avoid on a hit.
const statCalls = { count: 0 };
vi.mock('node:fs/promises', async (importActual) => {
  const actual = await importActual<typeof import('node:fs/promises')>();
  return {
    ...actual,
    stat: (...args: Parameters<typeof actual.stat>) => {
      statCalls.count += 1;
      return actual.stat(...args);
    },
  };
});

import { QueryEngine, type ParsedSource } from 'core';
import { Store } from 'n3';
import { ServeQueryCache } from './engine-map-query-cache';
import type { LoadedSources } from './engine-map-types';

/**
 * The path-aware freshness token (ADR-0054, #415) is folded into the cache key
 * so an underlying edit is a miss rather than a stale hit. The token may be
 * memoized per loaded generation ONLY when it is invariant for that generation's
 * lifetime (`freshnessFactsAreStable`):
 * - An *unpinned* materialized source's token is a stat-digest of live files. An
 *   on-disk edit moves it with no reload, so it MUST be recomputed (re-stat)
 *   every request — that per-request stat is the content-aware invalidation, and
 *   memoizing it would serve stale content (the regression these tests guard).
 * - A *pinned* materialized source's token is a pure path-hash of the resolved
 *   SHA; it only changes on reload, so it is memoized and never stats.
 */
describe('ServeQueryCache materialized freshness token memoization', () => {
  let dir: string;
  let files: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'serve-query-cache-'));
    files = [join(dir, 'a.ttl'), join(dir, 'b.ttl'), join(dir, 'c.ttl')];
    for (const f of files) await writeFile(f, '');
    statCalls.count = 0;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function materializedSource(resolvedSha?: string): ParsedSource {
    return {
      kind: 'glob',
      id: 'files',
      glob: join(dir, '*.ttl'),
      queryCache: true,
      ...(resolvedSha !== undefined ? { resolvedSha } : {}),
    };
  }

  function loadedGeneration(): LoadedSources {
    return { mode: 'materialized', store: new Store() };
  }

  function newCache(): ServeQueryCache {
    return new ServeQueryCache(dir, '0.0.0-test', undefined);
  }

  it('re-stats an unpinned source on every request so an on-disk edit is detected without a reload', async () => {
    const cache = newCache();
    const source = materializedSource();
    const sources = loadedGeneration();
    const engine = new QueryEngine(() => new Store(), {
      id: 'files',
      mode: 'materialized',
    });

    await cache.wrap(source, engine, sources, files);
    expect(statCalls.count).toBe(files.length);

    // A second request for the *same* loaded generation must NOT reuse a memoized
    // token: the stat-digest is #415's content-aware invalidation, so it restats
    // to catch a between-request on-disk edit (which produces no reload).
    await cache.wrap(source, engine, sources, files);
    expect(statCalls.count).toBe(files.length * 2);

    cache.close();
  });

  it('memoizes a pinned source per loaded generation and never stats', async () => {
    const cache = newCache();
    const source = materializedSource('deadbeef'); // pinned → resolved SHA
    const sources = loadedGeneration();
    const engine = new QueryEngine(() => new Store(), {
      id: 'files',
      mode: 'materialized',
    });

    // A pinned token is a pure path-hash of the resolved SHA — no file stat at
    // all, on the first request or any repeat for the same generation.
    await cache.wrap(source, engine, sources, files);
    await cache.wrap(source, engine, sources, files);
    expect(statCalls.count).toBe(0);

    cache.close();
  });
});
