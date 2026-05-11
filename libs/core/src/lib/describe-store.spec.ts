import { DataFactory, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import { describeStore } from './describe-store';
import { ttl } from './test/turtle';

const { namedNode } = DataFactory;

function storeFrom(quads: readonly { subject: unknown; predicate: unknown; object: unknown; graph: unknown }[]): Store {
  const s = new Store();
  s.addQuads(quads as never);
  return s;
}

describe('describeStore — step 1 (named-IRI match in s/o position)', () => {
  it('emits every quad where the seed appears as subject', () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:knows ex:bob .
      ex:alice ex:age 30 .
      ex:bob ex:knows ex:carol .
    `;
    const store = storeFrom(quads);

    const result = describeStore({
      store,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 10000,
    });

    expect(result.truncated).toBe(false);
    expect(result.quads).toHaveLength(2);
    const predicates = result.quads.map((q) => q.predicate.value).sort();
    expect(predicates).toEqual([
      'http://example.org/age',
      'http://example.org/knows',
    ]);
  });

  it('emits every quad where the seed appears as object', () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:knows ex:bob .
      ex:carol ex:knows ex:bob .
      ex:dave ex:owns ex:bob .
      ex:bob ex:age 25 .
    `;
    const store = storeFrom(quads);

    const result = describeStore({
      store,
      seed: namedNode('http://example.org/bob'),
      perSourceLimit: 10000,
    });

    expect(result.truncated).toBe(false);
    // 3 quads have bob as object + 1 quad has bob as subject = 4 total.
    expect(result.quads).toHaveLength(4);
    const subjects = result.quads.map((q) => q.subject.value).sort();
    expect(subjects).toEqual([
      'http://example.org/alice',
      'http://example.org/bob',
      'http://example.org/carol',
      'http://example.org/dave',
    ]);
  });

  it('returns an empty quad set when the seed is absent from the store', () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:knows ex:bob .
    `;
    const store = storeFrom(quads);

    const result = describeStore({
      store,
      seed: namedNode('http://example.org/ghost'),
      perSourceLimit: 10000,
    });

    expect(result.truncated).toBe(false);
    expect(result.quads).toEqual([]);
  });
});
