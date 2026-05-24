import { QueryEngine } from '@comunica/query-sparql';
import { serializeDescribeWire } from 'common';
import type { Quad, Store } from 'n3';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './fake-sparql-endpoint';

/** Fake SPARQL endpoint that evaluates CONSTRUCT/SELECT in-process against an n3 Store; preserves bnode identity and RDF-star. */
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

/** Rewrite quoted triples from SPARQL 1.1-star to RDF 1.2 form for Comunica. */
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
