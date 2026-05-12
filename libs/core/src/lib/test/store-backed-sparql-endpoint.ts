import { QueryEngine } from '@comunica/query-sparql';
import { serializeDescribeWire } from 'common';
import type { Quad, Store } from 'n3';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './fake-sparql-endpoint';

/**
 * A fake SPARQL HTTP endpoint that answers `CONSTRUCT` and `SELECT` queries by
 * evaluating them (via Comunica) against an in-memory n3 `Store` — named graphs
 * in the store are visible to `GRAPH ?g { … }`. Blank-node identity is preserved
 * within each response because the whole query runs in-process. `CONSTRUCT`
 * responses use `serializeDescribeWire` output (line-oriented N-Quads with
 * `<<...>>` quoted-triple subjects) so RDF-star annotations round-trip; `SELECT`
 * responses use `application/sparql-results+json`.
 */
export async function startStoreBackedSparqlEndpoint(
  store: Store,
): Promise<FakeSparqlEndpoint> {
  const engine = new QueryEngine();
  return startFakeSparqlEndpoint(async ({ query }) => {
    const rewritten = toComunicaStar(query);
    if (isSelectQuery(query)) {
      return {
        contentType: 'application/sparql-results+json',
        body: await runSelect(engine, rewritten, store),
      };
    }
    return {
      contentType: 'application/n-quads',
      body: serializeDescribeWire(await collectQuads(engine, rewritten, store)),
    };
  });
}

function isSelectQuery(query: string): boolean {
  // Our generated queries carry no prologue; a leading SELECT is unambiguous.
  return /^\s*select\b/i.test(query);
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

async function runSelect(
  engine: QueryEngine,
  query: string,
  store: Store,
): Promise<string> {
  const result = await engine.query(query, { sources: [store] });
  const { data } = await engine.resultToString(
    result,
    'application/sparql-results+json',
  );
  const chunks: Buffer[] = [];
  for await (const chunk of data) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
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
