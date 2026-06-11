import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openQueryCache, type OpenQueryCacheOptions } from './cache-store';

/**
 * The Cache store (ADR-0054, #413) is the deep module over `better-sqlite3` that
 * holds serialized {@link CachedResult} bodies on disk. These tests exercise it
 * through its public `get`/`set`/`close` surface against a temp directory — the
 * store's internals (SQLite, the schema-version stamp, the lazy TTL sweep) are
 * never inspected directly, so the spec survives a backend rewrite.
 */
describe('query cache store', () => {
  let dir: string;
  const SCHEMA_VERSION = '9.9.9-test';
  const HOUR_MS = 60 * 60 * 1000;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-query-cache-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function open(overrides: Partial<OpenQueryCacheOptions> = {}) {
    return openQueryCache({
      dir,
      schemaVersion: SCHEMA_VERSION,
      ttlMs: HOUR_MS,
      ...overrides,
    });
  }

  const meta = {
    format: 'json',
    contentType: 'application/sparql-results+json',
    sourceId: 's1',
  };

  /** Meta for a body owned by `sourceId`, optionally with a per-source cap. */
  function metaFor(sourceId: string, sourceMaxBytes?: number | null) {
    return {
      ...meta,
      sourceId,
      ...(sourceMaxBytes === undefined ? {} : { sourceMaxBytes }),
    };
  }

  /** A body of exactly `n` ASCII bytes, so byte budgets are easy to reason about. */
  const body = (n: number) => 'x'.repeat(n);

  it('returns a stored body and its serialization metadata for a known key', () => {
    const cache = open();
    try {
      cache.set('k1', '{"head":{}}', meta);
      expect(cache.get('k1')).toEqual({
        body: '{"head":{}}',
        format: 'json',
        contentType: 'application/sparql-results+json',
      });
    } finally {
      cache.close();
    }
  });

  it('returns undefined for an unknown key', () => {
    const cache = open();
    try {
      expect(cache.get('missing')).toBeUndefined();
    } finally {
      cache.close();
    }
  });

  it('caches an empty body (a legitimate "no matches" result)', () => {
    const cache = open();
    try {
      cache.set('empty', '', meta);
      expect(cache.get('empty')).toEqual({
        body: '',
        format: 'json',
        contentType: 'application/sparql-results+json',
      });
    } finally {
      cache.close();
    }
  });

  it('treats an entry past its absolute TTL as a miss', () => {
    let clock = 0;
    const cache = open({ ttlMs: 1000, now: () => clock });
    try {
      cache.set('k', 'body', meta);
      clock = 999;
      expect(cache.get('k')).not.toBeUndefined();
      clock = 1001;
      expect(cache.get('k')).toBeUndefined();
    } finally {
      cache.close();
    }
  });

  it('expires an entry by its per-source ttl override, shorter than the store default', () => {
    let clock = 0;
    const cache = open({ ttlMs: 10_000, now: () => clock });
    try {
      cache.set('short', 'body', { ...meta, ttlMs: 1000 });
      clock = 1500; // past the per-entry 1s ttl, still within the 10s default
      expect(cache.get('short')).toBeUndefined();
    } finally {
      cache.close();
    }
  });

  it('honors a per-entry ttl longer than the store default', () => {
    let clock = 0;
    const cache = open({ ttlMs: 1000, now: () => clock });
    try {
      cache.set('long', 'body', { ...meta, ttlMs: 10_000 });
      clock = 5000; // past the store default but within the per-entry override
      expect(cache.get('long')?.body).toBe('body');
    } finally {
      cache.close();
    }
  });

  it('falls back to the store default ttl when an entry sets no per-entry ttl', () => {
    let clock = 0;
    const cache = open({ ttlMs: 10_000, now: () => clock });
    try {
      cache.set('dflt', 'body', meta); // no per-entry ttl
      clock = 1500;
      expect(cache.get('dflt')?.body).toBe('body'); // still within the default
    } finally {
      cache.close();
    }
  });

  it('removes an expired entry on read (self-heal), not just hides it by clock', () => {
    let clock = 0;
    const cache = open({ ttlMs: 1000, now: () => clock });
    try {
      cache.set('k', 'body', meta);
      clock = 2000; // expired
      expect(cache.get('k')).toBeUndefined();
      clock = 0; // even rewinding the clock, the entry is gone
      expect(cache.get('k')).toBeUndefined();
    } finally {
      cache.close();
    }
  });

  it('persists entries across a close and reopen of the same store', () => {
    const first = open();
    first.set('k', 'persisted', meta);
    first.close();

    const second = open();
    try {
      expect(second.get('k')?.body).toBe('persisted');
    } finally {
      second.close();
    }
  });

  it('wipes the store when reopened under a different cache-schema version', () => {
    const first = open({ schemaVersion: 'v1' });
    first.set('k', 'old', meta);
    first.close();

    const second = open({ schemaVersion: 'v2' });
    try {
      expect(second.get('k')).toBeUndefined();
    } finally {
      second.close();
    }
  });

  it('keeps entries when reopened under the same cache-schema version', () => {
    const first = open({ schemaVersion: 'v1' });
    first.set('k', 'kept', meta);
    first.close();

    const second = open({ schemaVersion: 'v1' });
    try {
      expect(second.get('k')?.body).toBe('kept');
    } finally {
      second.close();
    }
  });

  it('evicts least-recently-accessed entries on write until total bytes fit maxBytes', () => {
    // Budget holds three 10-byte bodies; a fourth insert evicts the oldest.
    let tick = 0;
    const cache = open({ maxBytes: 30, now: () => ++tick });
    try {
      cache.set('a', body(10), metaFor('s1'));
      cache.set('b', body(10), metaFor('s1'));
      cache.set('c', body(10), metaFor('s1'));
      cache.set('d', body(10), metaFor('s1'));
      expect(cache.get('a')).toBeUndefined(); // least-recently-accessed, evicted
      expect(cache.get('b')?.body).toBe(body(10));
      expect(cache.get('c')?.body).toBe(body(10));
      expect(cache.get('d')?.body).toBe(body(10));
    } finally {
      cache.close();
    }
  });

  it('rescues a recently-read entry from eviction (recency is access, not insertion)', () => {
    let tick = 0;
    const cache = open({ maxBytes: 30, now: () => ++tick });
    try {
      cache.set('a', body(10), metaFor('s1'));
      cache.set('b', body(10), metaFor('s1'));
      cache.set('c', body(10), metaFor('s1'));
      cache.get('a'); // touch the oldest so it is no longer the eviction victim
      cache.set('d', body(10), metaFor('s1'));
      expect(cache.get('a')?.body).toBe(body(10)); // survived: just accessed
      expect(cache.get('b')).toBeUndefined(); // now the least-recently-accessed
      expect(cache.get('c')?.body).toBe(body(10));
      expect(cache.get('d')?.body).toBe(body(10));
    } finally {
      cache.close();
    }
  });

  it('bounds a source to its per-source maxBytes independently of the global pool', () => {
    let tick = 0;
    // Global budget is roomy, so any eviction here is the per-source cap at work.
    const cache = open({ maxBytes: 1000, now: () => ++tick });
    try {
      cache.set('s2a', body(10), metaFor('s2')); // uncapped, shares the pool
      cache.set('s1a', body(10), metaFor('s1', 20));
      cache.set('s1b', body(10), metaFor('s1', 20)); // s1 now at its 20-byte cap
      cache.set('s1c', body(10), metaFor('s1', 20)); // over cap → evict s1's oldest
      expect(cache.get('s1a')).toBeUndefined();
      expect(cache.get('s1b')?.body).toBe(body(10));
      expect(cache.get('s1c')?.body).toBe(body(10));
      expect(cache.get('s2a')?.body).toBe(body(10)); // a different source is untouched
    } finally {
      cache.close();
    }
  });

  it('bypasses a body larger than maxEntryBytes (not stored, no error)', () => {
    const cache = open({ maxEntryBytes: 50 });
    try {
      expect(() => cache.set('big', body(51), metaFor('s1'))).not.toThrow();
      expect(cache.get('big')).toBeUndefined();
      cache.set('ok', body(50), metaFor('s1')); // a body at the ceiling still fits
      expect(cache.get('ok')?.body).toBe(body(50));
    } finally {
      cache.close();
    }
  });

  it('warns once at open for an explicitly unbounded budget, and not for a bounded one', () => {
    const warnings: string[] = [];
    const logger = { warn: (message: string) => warnings.push(message) };

    const unbounded = open({ maxBytes: null, logger });
    unbounded.close();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/unbounded/i);

    const bounded = open({ maxBytes: 100, logger });
    bounded.close();
    const dflt = open({ logger }); // default budget, also no warning
    dflt.close();
    expect(warnings).toHaveLength(1);
  });

  it('purges expired entries on write, not only on read', () => {
    let clock = 0;
    const cache = open({ ttlMs: 1000, now: () => clock });
    try {
      cache.set('old', body(10), metaFor('s1'));
      clock = 2000; // 'old' is now past its TTL
      cache.set('new', body(10), metaFor('s1')); // a write sweeps expired rows
      clock = 0; // rewind: a merely TTL-hidden row would reappear here
      expect(cache.get('old')).toBeUndefined();
      expect(cache.get('new')?.body).toBe(body(10));
    } finally {
      cache.close();
    }
  });

  it('empties every entry on clear, surviving a reopen', () => {
    const cache = open();
    cache.set('a', body(10), metaFor('s1'));
    cache.set('b', body(10), metaFor('s2'));
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
    cache.close();

    // The wipe is durable: a reopened store sees nothing either.
    const reopened = open();
    try {
      expect(reopened.get('a')).toBeUndefined();
    } finally {
      reopened.close();
    }
  });

  it('reports total entry count and summed body bytes in stats', () => {
    const cache = open();
    try {
      cache.set('a', body(10), metaFor('s1'));
      cache.set('b', body(30), metaFor('s1'));
      const stats = cache.stats();
      expect(stats.entryCount).toBe(2);
      expect(stats.totalBytes).toBe(40);
    } finally {
      cache.close();
    }
  });

  it('breaks stats down per source, ordered by descending bytes', () => {
    const cache = open();
    try {
      cache.set('a', body(10), metaFor('s1'));
      cache.set('b', body(10), metaFor('s1'));
      cache.set('c', body(50), metaFor('s2'));
      const stats = cache.stats();
      expect(stats.perSource).toEqual([
        { sourceId: 's2', entryCount: 1, totalBytes: 50 },
        { sourceId: 's1', entryCount: 2, totalBytes: 20 },
      ]);
    } finally {
      cache.close();
    }
  });

  it('never evicts under an explicitly unbounded budget', () => {
    let tick = 0;
    const cache = open({ maxBytes: null, now: () => ++tick });
    try {
      for (const k of ['a', 'b', 'c', 'd', 'e']) {
        cache.set(k, body(1000), metaFor('s1'));
      }
      for (const k of ['a', 'b', 'c', 'd', 'e']) {
        expect(cache.get(k)?.body).toBe(body(1000));
      }
    } finally {
      cache.close();
    }
  });
});
