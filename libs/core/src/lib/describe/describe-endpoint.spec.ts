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

/** Minimal `application/sparql-results+json` body — every cell is treated as a URI. */
function selectJson(rows: ReadonlyArray<Record<string, string>>): string {
  const vars = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return JSON.stringify({
    head: { vars },
    results: {
      bindings: rows.map((r) =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [k, { type: 'uri', value: v }]),
        ),
      ),
    },
  });
}

const SELECT_JSON = 'application/sparql-results+json';

describe('describeEndpoint (depth-0, ADR-0019)', () => {
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

  it('emits every quad where the seed appears as subject or object via two CONSTRUCT queries', async () => {
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
    // One outgoing CONSTRUCT, one incoming CONSTRUCT, one RDF-star post-pass
    // batch — and never anything deeper.
    expect(ep?.requestCount() ?? 0).toBe(3);
  });

  it('carries the named graph an endpoint quad came from', async () => {
    const g = namedNode('http://example.org/graph1');
    const result = await describeOver(
      storeFrom([
        quad(
          namedNode('http://example.org/alice'),
          namedNode('http://example.org/knows'),
          namedNode('http://example.org/bob'),
          g,
        ),
      ]),
      'http://example.org/alice',
    );
    expect(result.truncated).toBe(false);
    expect(result.quads).toHaveLength(1);
    expect(result.quads[0].graph.value).toBe('http://example.org/graph1');
  });

  it('keeps a triple distinct in each named graph it appears in', async () => {
    const knows = namedNode('http://example.org/knows');
    const result = await describeOver(
      storeFrom([
        quad(
          namedNode('http://example.org/alice'),
          knows,
          namedNode('http://example.org/bob'),
          namedNode('http://example.org/g1'),
        ),
        quad(
          namedNode('http://example.org/alice'),
          knows,
          namedNode('http://example.org/bob'),
          namedNode('http://example.org/g2'),
        ),
      ]),
      'http://example.org/alice',
    );
    expect(result.quads).toHaveLength(2);
    expect(new Set(result.quads.map((q) => q.graph.value))).toEqual(
      new Set(['http://example.org/g1', 'http://example.org/g2']),
    );
  });

  it('drops the default-graph copy when the same triple is in a named graph', async () => {
    const knows = namedNode('http://example.org/knows');
    const result = await describeOver(
      storeFrom([
        quad(namedNode('http://example.org/alice'), knows, namedNode('http://example.org/bob')),
        quad(
          namedNode('http://example.org/alice'),
          knows,
          namedNode('http://example.org/bob'),
          namedNode('http://example.org/g1'),
        ),
      ]),
      'http://example.org/alice',
    );
    expect(result.quads).toHaveLength(1);
    expect(result.quads[0].graph.value).toBe('http://example.org/g1');
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

  it('leaves blank nodes dangling — no automatic expansion — and reports truncated', async () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:list _:b1 .
      _:b1 ex:next _:b2 .
      _:b2 ex:value "tail" .
    `;
    const result = await describeOver(
      storeFrom(quads),
      'http://example.org/alice',
    );
    // Only the seed's direct edge to the blank node; the chain past it is
    // not fetched.
    expect(result.quads).toHaveLength(1);
    expect(result.quads[0].predicate.value).toBe('http://example.org/list');
    expect(result.quads[0].object.termType).toBe('BlankNode');
    expect(result.truncated).toBe(true);
  });

  it('leaves an o-side dangling blank node truncated too', async () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      _:b1 ex:about ex:alice .
      _:b1 ex:source "wiki" .
      ex:other ex:p ex:thing .
    `;
    const result = await describeOver(
      storeFrom(quads),
      'http://example.org/alice',
    );
    // _:b1 ex:about ex:alice is the only quad mentioning the seed; _:b1's
    // other properties are a hop away and not fetched.
    expect(result.quads).toHaveLength(1);
    expect(result.quads[0].subject.termType).toBe('BlankNode');
    expect(result.truncated).toBe(true);
  });

  it('reports truncated when the per-source cap fires', async () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:a "1" .
      ex:alice ex:b "2" .
      ex:alice ex:c "3" .
      ex:alice ex:d "4" .
    `;
    const result = await describeOver(
      storeFrom(quads),
      'http://example.org/alice',
      2,
    );
    expect(result.truncated).toBe(true);
    expect(result.quads).toHaveLength(2);
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

  it('degrades gracefully when one edge direction fails: partial result, truncated', async () => {
    ep = await startFakeSparqlEndpoint(({ query }) => {
      if (query.includes('<<')) return { body: '' }; // RDF-star post-pass
      if (query.includes('?s ?p <http://example.org/alice>')) {
        return { status: 500, body: 'incoming leg blew up' };
      }
      return {
        contentType: SELECT_JSON,
        body: selectJson([
          {
            p: 'http://example.org/knows',
            o: 'http://example.org/bob',
          },
        ]),
      };
    });
    const endpoint: ParsedEndpointSource = { kind: 'endpoint', endpoint: ep.url };
    const result = await describeEndpoint({
      endpoint,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 10000,
    });
    expect(result.quads).toHaveLength(1);
    expect(result.quads[0].object.value).toBe('http://example.org/bob');
    expect(result.truncated).toBe(true);
  });

  it('throws when both edge directions fail', async () => {
    ep = await startFakeSparqlEndpoint(() => ({ status: 500, body: 'down' }));
    const endpoint: ParsedEndpointSource = { kind: 'endpoint', endpoint: ep.url };
    await expect(
      describeEndpoint({
        endpoint,
        seed: namedNode('http://example.org/alice'),
        perSourceLimit: 10000,
      }),
    ).rejects.toThrow();
  });

  it('with paths: [] behaves exactly as the depth-0 slice (two queries + post-pass)', async () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:knows ex:bob .
      ex:carol ex:knows ex:alice .
    `;
    ep = await startStoreBackedSparqlEndpoint(storeFrom(quads));
    const endpoint: ParsedEndpointSource = { kind: 'endpoint', endpoint: ep.url };
    const result = await describeEndpoint({
      endpoint,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 10000,
      paths: [],
    });
    expect(result.truncated).toBe(false);
    expect(result.quads).toHaveLength(2);
    expect(ep.requestCount()).toBe(3);
  });

  it('expands a predicate-pinned path one hop; the new quads appear pruned through describeStore', async () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:name "Alice" .
      ex:alice ex:list _:b1 .
      _:b1 ex:value "head" .
      _:b1 ex:next _:b2 .
      _:b2 ex:value "tail" .
    `;
    ep = await startStoreBackedSparqlEndpoint(storeFrom(quads));
    const endpoint: ParsedEndpointSource = { kind: 'endpoint', endpoint: ep.url };
    const baseline = await describeEndpoint({
      endpoint,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 10000,
      paths: [],
    });
    const depth0Requests = ep.requestCount();
    expect(baseline.quads).toHaveLength(2); // ex:name "Alice", ex:list _:b1

    const beforeExpansion = ep.requestCount();
    const result = await describeEndpoint({
      endpoint,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 10000,
      paths: [[{ predicate: 'http://example.org/list', inverse: false }]],
    });
    // One hop further: _:b1's own quads (ex:value "head", ex:next _:b2). The
    // chain past _:b2 stays dangling.
    expect(result.quads).toHaveLength(4);
    expect(
      result.quads.some(
        (q) =>
          q.predicate.value === 'http://example.org/value' &&
          q.object.value === 'head',
      ),
    ).toBe(true);
    // still dangling at _:b2 → truncated
    expect(result.truncated).toBe(true);
    // exactly one query more than the depth-0 slice over the same data
    expect(ep.requestCount() - beforeExpansion).toBe(depth0Requests + 1);
  });

  it('an expanded hop carries the named graph its quads live in', async () => {
    const b1 = DataFactory.blankNode('b1');
    const ep2 = storeFrom([
      // chain edge in the default graph; the bnode's own quads in a named graph
      quad(namedNode('http://example.org/alice'), namedNode('http://example.org/list'), b1),
      quad(b1, namedNode('http://example.org/value'), literal('head'), namedNode('http://example.org/g1')),
    ]);
    ep = await startStoreBackedSparqlEndpoint(ep2);
    const endpoint: ParsedEndpointSource = { kind: 'endpoint', endpoint: ep.url };
    const result = await describeEndpoint({
      endpoint,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 10000,
      paths: [[{ predicate: 'http://example.org/list', inverse: false }]],
    });
    const valueQuad = result.quads.find(
      (q) => q.predicate.value === 'http://example.org/value',
    );
    expect(valueQuad?.object.value).toBe('head');
    expect(valueQuad?.graph.value).toBe('http://example.org/g1');
  });

  it('degrades gracefully when a path query fails but depth-0 succeeded: partial result, truncated', async () => {
    ep = await startFakeSparqlEndpoint(({ query }) => {
      if (query.includes('isBlank')) {
        return { status: 500, body: 'path walk blew up' };
      }
      if (query.includes('<<')) return { body: '' }; // RDF-star post-pass
      return {
        contentType: SELECT_JSON,
        body: selectJson([
          {
            p: 'http://example.org/knows',
            o: 'http://example.org/bob',
          },
        ]),
      };
    });
    const endpoint: ParsedEndpointSource = { kind: 'endpoint', endpoint: ep.url };
    const result = await describeEndpoint({
      endpoint,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 10000,
      paths: [[{ predicate: 'http://example.org/knows', inverse: false }]],
    });
    expect(result.quads).toHaveLength(1);
    expect(result.quads[0].object.value).toBe('http://example.org/bob');
    expect(result.truncated).toBe(true);
  });
});
