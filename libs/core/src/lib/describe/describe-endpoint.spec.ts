import { DataFactory, Store } from 'n3';
import { afterEach, describe, expect, it } from 'vitest';
import { describeEndpoint } from './describe-endpoint';
import type { ParsedEndpointSource } from '../sources';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from '../test/fake-sparql-endpoint';
import { startStoreBackedSparqlEndpoint } from '../test/store-backed-sparql-endpoint';
import { ttl } from '../test/turtle';

const { namedNode, literal, quad } = DataFactory;

function storeFrom(quads: readonly unknown[]): Store {
  const s = new Store();
  s.addQuads(quads as never);
  return s;
}

describe('describeEndpoint', () => {
  let ep: FakeSparqlEndpoint | undefined;

  afterEach(async () => {
    if (ep) await ep.close();
    ep = undefined;
  });

  async function describeOver(
    store: Store,
    iri: string,
    perSourceLimit = 10000,
  ): Promise<{ quads: ReturnType<typeof quad>[]; truncated: boolean }> {
    ep = await startStoreBackedSparqlEndpoint(store);
    const endpoint: ParsedEndpointSource = {
      kind: 'endpoint',
      endpoint: ep.url,
    };
    return describeEndpoint({ endpoint, seed: namedNode(iri), perSourceLimit });
  }

  it('emits every quad where the seed appears as subject or object', async () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:knows ex:bob .
      ex:carol ex:knows ex:alice .
      ex:alice ex:age 30 .
      ex:bob ex:knows ex:dave .
    `;
    const result = await describeOver(
      storeFrom(quads),
      'http://example.org/alice',
    );
    expect(result.truncated).toBe(false);
    // alice knows bob, carol knows alice, alice age 30 = 3.
    expect(result.quads).toHaveLength(3);
    // No blank node in the description ⇒ no deeper round trip is fired
    // (two closure queries + one RDF-star post-pass batch).
    expect(ep?.requestCount() ?? 0).toBe(3);
  });

  it('expands a multi-hop blank-node chain, matching describeStore', async () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:list _:b1 .
      _:b1 ex:next _:b2 .
      _:b2 ex:next _:b3 .
      _:b3 ex:value "tail" .
      ex:noise ex:irrelevant "x" .
    `;
    const result = await describeOver(
      storeFrom(quads),
      'http://example.org/alice',
    );
    expect(result.truncated).toBe(false);
    expect(result.quads).toHaveLength(4);
    expect(result.quads.map((q) => q.predicate.value).sort()).toEqual([
      'http://example.org/list',
      'http://example.org/next',
      'http://example.org/next',
      'http://example.org/value',
    ]);
  });

  it('expands an o-side blank-node chain symmetrically', async () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      _:b1 ex:about ex:alice .
      _:b1 ex:source "wiki" .
      _:b1 ex:confidence 0.9 .
      ex:other ex:p ex:thing .
    `;
    const result = await describeOver(
      storeFrom(quads),
      'http://example.org/alice',
    );
    expect(result.truncated).toBe(false);
    expect(result.quads).toHaveLength(3);
    expect(result.quads.every((q) => q.subject.termType === 'BlankNode')).toBe(
      true,
    );
  });

  it('does not traverse named IRIs', async () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:knows ex:bob .
      ex:bob ex:knows ex:carol .
      ex:bob ex:age 40 .
    `;
    const result = await describeOver(
      storeFrom(quads),
      'http://example.org/alice',
    );
    expect(result.truncated).toBe(false);
    expect(result.quads).toHaveLength(1);
    expect(result.quads[0].object.value).toBe('http://example.org/bob');
  });

  it('terminates on a blank-node cycle within bounded round trips', async () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:has _:b1 .
      _:b1 ex:loops _:b2 .
      _:b2 ex:loops _:b1 .
      _:b1 ex:label "first" .
    `;
    const result = await describeOver(
      storeFrom(quads),
      'http://example.org/alice',
    );
    expect(result.truncated).toBe(false);
    expect(result.quads).toHaveLength(4);
    expect(ep?.requestCount() ?? 0).toBeLessThanOrEqual(5);
  });

  it('reports truncated and stays within bounded round trips when the cap fires', async () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:has _:b1 .
      _:b1 ex:a "1" .
      _:b1 ex:b "2" .
      _:b1 ex:c "3" .
      _:b1 ex:d "4" .
    `;
    const result = await describeOver(
      storeFrom(quads),
      'http://example.org/alice',
      2,
    );
    expect(result.truncated).toBe(true);
    expect(result.quads).toHaveLength(2);
    expect(ep?.requestCount() ?? 0).toBeLessThanOrEqual(5);
  });

  it('returns an empty result when the seed is absent', async () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:knows ex:bob .
    `;
    const result = await describeOver(
      storeFrom(quads),
      'http://example.org/ghost',
    );
    expect(result.truncated).toBe(false);
    expect(result.quads).toEqual([]);
  });

  it('includes RDF-star annotations whose quoted triple is in the result', async () => {
    const knows = namedNode('http://example.org/knows');
    const aliceKnowsBob = quad(
      namedNode('http://example.org/alice'),
      knows,
      namedNode('http://example.org/bob'),
    );
    const annotation = quad(
      quad(
        namedNode('http://example.org/alice'),
        knows,
        namedNode('http://example.org/bob'),
      ),
      namedNode('http://example.org/source'),
      literal('wiki'),
    );
    const carolKnowsDave = quad(
      namedNode('http://example.org/carol'),
      knows,
      namedNode('http://example.org/dave'),
    );
    const unrelatedAnnotation = quad(
      quad(
        namedNode('http://example.org/carol'),
        knows,
        namedNode('http://example.org/dave'),
      ),
      namedNode('http://example.org/source'),
      literal('rumor'),
    );
    const result = await describeOver(
      storeFrom([
        aliceKnowsBob,
        annotation,
        carolKnowsDave,
        unrelatedAnnotation,
      ]),
      'http://example.org/alice',
    );
    expect(result.truncated).toBe(false);
    // alice knows bob + its annotation = 2; carol/dave triple and annotation excluded.
    expect(result.quads).toHaveLength(2);
    const annotated = result.quads.find(
      (q) => (q.subject.termType as string) === 'Quad',
    );
    expect(annotated?.object.value).toBe('wiki');
  });

  it('returns the last good round as truncated when a deeper query fails', async () => {
    // First closure round returns a seed→blank edge, forcing a second round;
    // that one 500s (Virtuoso rejects the larger UNION). The partial
    // description must come back marked truncated, not as an error.
    let n = 0;
    ep = await startFakeSparqlEndpoint(({ query }) => {
      // Annotation post-pass (quoted-triple subjects) — no annotations.
      if (query.includes('<<')) return { body: '' };
      n += 1;
      if (n <= 2) {
        return {
          contentType: 'application/n-triples',
          body:
            '<http://example.org/alice> <http://example.org/has> _:b1 .\n' +
            '_:b1 <http://example.org/label> "first" .\n',
        };
      }
      return { status: 500, body: 'SQ142: too many columns' };
    });
    const endpoint: ParsedEndpointSource = {
      kind: 'endpoint',
      endpoint: ep.url,
    };
    const result = await describeEndpoint({
      endpoint,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 10000,
    });
    expect(result.truncated).toBe(true);
    expect(result.quads).toHaveLength(2);
  });
});
