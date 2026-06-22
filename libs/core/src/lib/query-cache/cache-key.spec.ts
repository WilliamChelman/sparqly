import { describe, expect, it } from 'vitest';
import { deriveCacheKey, type CacheKeyInput } from './cache-key';

/**
 * Cache key derivation (ADR-0054, #413) is pure: it folds the identity of a
 * `(target source, verbatim query, output format, display context, cache-schema
 * version)` combination into a single digest. Query identity is verbatim bytes —
 * no normalization — so two byte-identical queries share an entry and any change
 * to a component is a different key (a miss).
 */
describe('deriveCacheKey', () => {
  function input(overrides: Partial<CacheKeyInput> = {}): CacheKeyInput {
    return {
      sourceId: 'dbpedia',
      query: 'SELECT * WHERE { ?s ?p ?o }',
      format: 'json',
      contextDigest: 'ctx-0',
      freshnessToken: '',
      schemaVersion: '1',
      ...overrides,
    };
  }

  it('is stable: the same combination yields the same key', () => {
    expect(deriveCacheKey(input())).toBe(deriveCacheKey(input()));
  });

  it('distinguishes a different query', () => {
    expect(
      deriveCacheKey(input({ query: 'SELECT * WHERE { ?a ?b ?c }' })),
    ).not.toBe(deriveCacheKey(input()));
  });

  it('distinguishes a different output format', () => {
    expect(deriveCacheKey(input({ format: 'turtle' }))).not.toBe(
      deriveCacheKey(input({ format: 'json' })),
    );
  });

  it('distinguishes a different display context', () => {
    expect(deriveCacheKey(input({ contextDigest: 'ctx-1' }))).not.toBe(
      deriveCacheKey(input({ contextDigest: 'ctx-0' })),
    );
  });

  it('distinguishes a different source id', () => {
    expect(deriveCacheKey(input({ sourceId: 'wikidata' }))).not.toBe(
      deriveCacheKey(input({ sourceId: 'dbpedia' })),
    );
  });

  it('distinguishes a different freshness token (underlying content changed)', () => {
    expect(deriveCacheKey(input({ freshnessToken: 'stat:abc' }))).not.toBe(
      deriveCacheKey(input({ freshnessToken: 'stat:def' })),
    );
  });

  it('distinguishes a different cache-schema version', () => {
    expect(deriveCacheKey(input({ schemaVersion: '2' }))).not.toBe(
      deriveCacheKey(input({ schemaVersion: '1' })),
    );
  });

  it('cannot be forged by shifting bytes across the field boundary', () => {
    // Length-prefixing means a source id ending in the query's first chars
    // cannot collide with the canonical split.
    expect(deriveCacheKey(input({ sourceId: 'ab', query: 'cd' }))).not.toBe(
      deriveCacheKey(input({ sourceId: 'a', query: 'bcd' })),
    );
  });
});
