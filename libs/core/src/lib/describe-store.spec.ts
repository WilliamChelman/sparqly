import { DataFactory, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import { describeStore } from './describe-store';
import { ttl } from './test/turtle';

const { namedNode, literal, quad } = DataFactory;

function storeFrom(quads: readonly { subject: unknown; predicate: unknown; object: unknown; graph: unknown }[]): Store {
  const s = new Store();
  s.addQuads(quads as never);
  return s;
}

describe('describeStore', () => {
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

  it('expands an s-side bnode chain into the result set (one hop)', () => {
    // Seed has a bnode as object; the bnode carries further triples that must
    // come back with the seed's quads.
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:address _:b1 .
      _:b1 ex:city "Paris" .
      _:b1 ex:zip "75001" .
      ex:irrelevant ex:foo "bar" .
    `;
    const store = storeFrom(quads);

    const result = describeStore({
      store,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 10000,
    });

    expect(result.truncated).toBe(false);
    expect(result.quads).toHaveLength(3);
    const cityQuads = result.quads.filter(
      (q) => q.predicate.value === 'http://example.org/city',
    );
    expect(cityQuads).toHaveLength(1);
    expect(cityQuads[0].object.value).toBe('Paris');
  });

  it('expands an o-side bnode chain symmetrically (bnode appears as subject of seed-object quad)', () => {
    // Reification-like: an anonymous statement targets the seed.
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      _:b1 ex:about ex:alice .
      _:b1 ex:source "wiki" .
      _:b1 ex:confidence 0.9 .
      ex:other ex:p ex:thing .
    `;
    const store = storeFrom(quads);

    const result = describeStore({
      store,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 10000,
    });

    expect(result.truncated).toBe(false);
    // _:b1 ex:about ex:alice (seed in object) + _:b1 ex:source + _:b1 ex:confidence = 3.
    expect(result.quads).toHaveLength(3);
    expect(result.quads.every((q) => q.subject.termType === 'BlankNode')).toBe(true);
  });

  it('iterates the bnode-chain fixpoint across multiple hops', () => {
    // List-shaped: alice -> _:b1 -> _:b2 -> _:b3 -> "tail".
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:list _:b1 .
      _:b1 ex:next _:b2 .
      _:b2 ex:next _:b3 .
      _:b3 ex:value "tail" .
      ex:noise ex:irrelevant "x" .
    `;
    const store = storeFrom(quads);

    const result = describeStore({
      store,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 10000,
    });

    expect(result.truncated).toBe(false);
    expect(result.quads).toHaveLength(4);
    const predicates = result.quads.map((q) => q.predicate.value).sort();
    expect(predicates).toEqual([
      'http://example.org/list',
      'http://example.org/next',
      'http://example.org/next',
      'http://example.org/value',
    ]);
  });

  it('terminates on a bnode cycle without infinite loop', () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:has _:b1 .
      _:b1 ex:loops _:b2 .
      _:b2 ex:loops _:b1 .
      _:b1 ex:label "first" .
    `;
    const store = storeFrom(quads);

    const result = describeStore({
      store,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 10000,
    });

    expect(result.truncated).toBe(false);
    // alice->_:b1, _:b1->_:b2, _:b2->_:b1, _:b1 label = 4.
    expect(result.quads).toHaveLength(4);
  });

  it('does not traverse named IRIs (one hop only via named-IRI links)', () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:knows ex:bob .
      ex:bob ex:knows ex:carol .
      ex:bob ex:age 40 .
      ex:carol ex:age 35 .
    `;
    const store = storeFrom(quads);

    const result = describeStore({
      store,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 10000,
    });

    expect(result.truncated).toBe(false);
    // Only the one quad where alice is subject; bob and carol's quads
    // must NOT be pulled in because they are reached via named IRIs.
    expect(result.quads).toHaveLength(1);
    expect(result.quads[0].subject.value).toBe('http://example.org/alice');
    expect(result.quads[0].object.value).toBe('http://example.org/bob');
  });

  it('includes RDF-star annotations whose quoted triple is in the result', () => {
    // Asserted triple about the seed.
    const asserted = quad(
      namedNode('http://example.org/alice'),
      namedNode('http://example.org/knows'),
      namedNode('http://example.org/bob'),
    );
    // RDF-star annotation: <<alice knows bob>> has source "wiki".
    const annotation = quad(
      quad(
        namedNode('http://example.org/alice'),
        namedNode('http://example.org/knows'),
        namedNode('http://example.org/bob'),
      ),
      namedNode('http://example.org/source'),
      literal('wiki'),
    );
    const store = new Store();
    store.addQuad(asserted);
    store.addQuad(annotation);

    const result = describeStore({
      store,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 10000,
    });

    expect(result.truncated).toBe(false);
    expect(result.quads).toHaveLength(2);
    const annotated = result.quads.find(
      (q) => (q.subject.termType as string) === 'Quad',
    );
    expect(annotated).toBeDefined();
    expect(annotated?.object.value).toBe('wiki');
  });

  it('excludes RDF-star annotations whose quoted triple is not in the result', () => {
    // Asserted triple about the seed.
    const aboutAlice = quad(
      namedNode('http://example.org/alice'),
      namedNode('http://example.org/knows'),
      namedNode('http://example.org/bob'),
    );
    // A triple that does NOT mention the seed (carol/dave) — out of result.
    const unrelated = quad(
      namedNode('http://example.org/carol'),
      namedNode('http://example.org/knows'),
      namedNode('http://example.org/dave'),
    );
    // Annotation on an out-of-result triple — must be excluded.
    const annotation = quad(
      quad(
        namedNode('http://example.org/carol'),
        namedNode('http://example.org/knows'),
        namedNode('http://example.org/dave'),
      ),
      namedNode('http://example.org/source'),
      literal('rumor'),
    );
    const store = new Store();
    store.addQuad(aboutAlice);
    store.addQuad(unrelated);
    store.addQuad(annotation);

    const result = describeStore({
      store,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 10000,
    });

    expect(result.truncated).toBe(false);
    expect(result.quads).toHaveLength(1);
    expect(result.quads[0].subject.value).toBe('http://example.org/alice');
  });

  it('stops adding quads when perSourceLimit is reached and reports truncated', () => {
    // 5 quads where alice is subject; cap to 3.
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:p1 "1" .
      ex:alice ex:p2 "2" .
      ex:alice ex:p3 "3" .
      ex:alice ex:p4 "4" .
      ex:alice ex:p5 "5" .
    `;
    const store = storeFrom(quads);

    const result = describeStore({
      store,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 3,
    });

    expect(result.truncated).toBe(true);
    expect(result.quads).toHaveLength(3);
  });

  it('cap firing mid-bnode-chain still returns a partial result and truncated: true', () => {
    // Seed has a bnode chain that would expand past the cap.
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:has _:b1 .
      _:b1 ex:a "1" .
      _:b1 ex:b "2" .
      _:b1 ex:c "3" .
      _:b1 ex:d "4" .
    `;
    const store = storeFrom(quads);

    const result = describeStore({
      store,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 2,
    });

    expect(result.truncated).toBe(true);
    expect(result.quads).toHaveLength(2);
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
