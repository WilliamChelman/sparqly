import { QueryEngine } from '@comunica/query-sparql';
import { serializeDescribeWire } from 'common';
import type { Quad, Store } from 'n3';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './fake-sparql-endpoint';

/**
 * A fake SPARQL HTTP endpoint that answers CONSTRUCT queries by evaluating them
 * (via Comunica) against an in-memory n3 `Store`. Blank-node identity is
 * preserved within each response because the whole query runs in-process —
 * exactly what `describeEndpoint`'s iterative CONSTRUCTs assume. Responses use
 * `serializeDescribeWire` output (line-oriented N-Quads with `<<...>>`
 * quoted-triple subjects) so RDF-star annotations round-trip.
 */
export async function startStoreBackedSparqlEndpoint(
  store: Store,
): Promise<FakeSparqlEndpoint> {
  const engine = new QueryEngine();
  return startFakeSparqlEndpoint(async ({ query }) => {
    const quads = await collectQuads(engine, toComunicaStar(query), store);
    return {
      contentType: 'application/n-quads',
      body: serializeDescribeWire(quads),
    };
  });
}

/**
 * Rewrite SPARQL 1.1-star quoted triples (`<< ?s ?p ?o >>`) to the RDF 1.2
 * triple-term syntax (`<<( ?s ?p ?o )>>`) that Comunica understands. A real
 * RDF-star endpoint accepts the 1.1 form `describeEndpoint` sends; this adapts
 * it to the engine backing the fake.
 */
function toComunicaStar(query: string): string {
  return query.replace(/<<\s+(.+?)\s+>>/g, '<<( $1 )>>');
}

function collectQuads(
  engine: QueryEngine,
  query: string,
  store: Store,
): Promise<Quad[]> {
  return new Promise<Quad[]>((resolve, reject) => {
    engine
      .queryQuads(query, { sources: [store] })
      .then((stream) => {
        const out: Quad[] = [];
        stream.on('data', (q: Quad) => out.push(q));
        stream.on('end', () => resolve(out));
        stream.on('error', reject);
      })
      .catch(reject);
  });
}
