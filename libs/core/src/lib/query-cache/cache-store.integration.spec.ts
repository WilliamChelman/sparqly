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
  };

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
});
