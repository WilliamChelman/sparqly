import { parseDescribeWire } from 'common';
import { Store, type Literal, type NamedNode, type Quad, type Term } from 'n3';
import { describeStore, type DescribeStoreResult } from './describe-store';
import {
  DEFAULT_ENDPOINT_TIMEOUT_MS,
  collectInjectedHeaders,
  describeEndpointError,
} from '../engine';
import type { ParsedEndpointSource } from '../sources';

/** Blank-node-chain depth fetched per remote CONSTRUCT round trip. */
const DEPTH_CHUNK = 4;
/** Round-trip safety net — chains deeper than this are reported truncated. */
const MAX_DEPTH = 64;
/** Quoted triples per RDF-star post-pass query. */
const POST_PASS_BATCH = 50;
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

export interface DescribeEndpointOptions {
  endpoint: ParsedEndpointSource;
  seed: NamedNode;
  perSourceLimit: number;
}

export interface DescribeEndpointResult {
  quads: Quad[];
  truncated: boolean;
}

/**
 * Describe a seed IRI against a remote SPARQL endpoint (ADR-0015, issue #189).
 *
 * Runs the same algorithm contract as {@link describeStore} — seed-as-s/o,
 * symmetric blank-node-chain fixpoint, RDF-star post-pass, no named-IRI
 * traversal — but over the wire via iterative `CONSTRUCT` queries
 * instead of `store.match`. The blank-node closure is fetched `DEPTH_CHUNK`
 * levels at a time (one query per edge direction); each response is internally
 * consistent (the endpoint evaluates the whole query), so loading them into a
 * fresh `Store` and running `describeStore` reproduces the algorithm exactly
 * for everything within the fetched depth. Iteration stops once the description stops growing or the
 * per-source cap fires, keeping wire round-trips bounded.
 */
export async function describeEndpoint(
  options: DescribeEndpointOptions,
): Promise<DescribeEndpointResult> {
  const { endpoint, seed, perSourceLimit } = options;
  const run = makeConstructRunner(endpoint);

  let desc: DescribeStoreResult = { quads: [], truncated: false };
  let prevSize = -1;
  let depth = 0;
  let depthExhausted = false;
  for (;;) {
    depth += DEPTH_CHUNK;
    const store = new Store();
    const [outgoing, incoming] = buildClosureQueries(seed.value, depth);
    const outP = run(outgoing);
    const inP = run(incoming);
    let outQuads: Quad[];
    let inQuads: Quad[];
    try {
      [outQuads, inQuads] = await Promise.all([outP, inP]);
    } catch (err) {
      // One leg may still be in flight — keep its eventual rejection from
      // becoming an unhandled rejection.
      outP.catch(() => undefined);
      inP.catch(() => undefined);
      // Deep closure rounds grow the `UNION`; some engines (notably Virtuoso)
      // reject or run out of memory on the larger query. If an earlier round
      // already produced a description, treat the failure as a depth cutoff
      // rather than failing the whole describe.
      if (prevSize >= 0) {
        depthExhausted = true;
        break;
      }
      throw err;
    }
    store.addQuads(outQuads);
    store.addQuads(inQuads);
    desc = describeStore({ store, seed, perSourceLimit });
    if (
      desc.truncated ||
      desc.quads.length === 0 ||
      desc.quads.length === prevSize ||
      !hasBlankNode(desc.quads)
    ) {
      // No blank node in the description ⇒ the blank-node-chain fixpoint is
      // already reached; deeper rounds cannot add anything.
      break;
    }
    prevSize = desc.quads.length;
    if (depth >= MAX_DEPTH) {
      depthExhausted = true;
      break;
    }
  }

  const annotations = await fetchAnnotations(run, desc.quads);
  if (annotations.length === 0) {
    return { quads: desc.quads, truncated: desc.truncated || depthExhausted };
  }
  const merged = new Store();
  merged.addQuads(desc.quads);
  merged.addQuads(annotations);
  const final = describeStore({ store: merged, seed, perSourceLimit });
  return { quads: final.quads, truncated: final.truncated || depthExhausted };
}

function hasBlankNode(quads: ReadonlyArray<Quad>): boolean {
  return quads.some(
    (q) =>
      q.subject.termType === 'BlankNode' || q.object.termType === 'BlankNode',
  );
}

function makeConstructRunner(
  endpoint: ParsedEndpointSource,
): (query: string) => Promise<Quad[]> {
  const timeoutMs = endpoint.timeoutMs ?? DEFAULT_ENDPOINT_TIMEOUT_MS;
  const headers: Record<string, string> = {
    ...collectInjectedHeaders(endpoint),
    'Content-Type': 'application/sparql-query',
    Accept: 'application/n-quads, application/n-triples;q=0.9, text/turtle;q=0.5',
  };
  return async (query) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint.endpoint, {
        method: 'POST',
        headers,
        body: query,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return parseDescribeWire(await res.text());
    } catch (err) {
      throw new Error(
        `endpoint ${endpoint.endpoint}: ${describeEndpointError(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * The two `CONSTRUCT` queries (outgoing `?z ?p ?o`, incoming `?s ?p ?z`) that
 * together fetch a superset of the seed's description down to `maxDepth`
 * blank-node hops. `?z` is bound by a `UNION` over chain lengths `0..maxDepth`:
 * length 0 is the seed itself (`VALUES`); the length-`k` branch walks a `k`-step
 * blank-only path out of the seed (either edge direction at every step) with
 * per-branch `!sameTerm` filters forbidding revisits, so each branch is finite
 * even on cyclic data and empties once `k` exceeds the reachable blank-node
 * count. `describeStore` then prunes the superset down to the exact algorithm
 * result.
 *
 * Why two queries instead of one with `BIND(?z AS ?s)` spokes: Virtuoso (e.g.
 * Fedlex's) rejects a `CONSTRUCT` whose `WHERE` is a many-branch `UNION` with
 * `BIND` inside — `SQ142: Different number of expected and generated columns` —
 * so every branch here keeps the same projected variables and no `BIND`.
 */
function buildClosureQueries(
  seedIri: string,
  maxDepth: number,
): readonly [string, string] {
  const seed = `<${seedIri}>`;
  const branches: string[] = [`VALUES ?z { ${seed} }`];
  for (let k = 1; k <= maxDepth; k++) {
    const parts: string[] = [];
    const nodes: string[] = [];
    let prev = seed;
    for (let i = 1; i <= k; i++) {
      const node = i === k ? '?z' : `?m${i}`;
      parts.push(`{ ${prev} ?e${i} ${node} } UNION { ${node} ?e${i} ${prev} }`);
      parts.push(`FILTER(isBlank(${node}))`);
      for (const seen of nodes) parts.push(`FILTER(!sameTerm(${node}, ${seen}))`);
      nodes.push(node);
      prev = node;
    }
    branches.push(parts.join(' '));
  }
  const where = `{ ${branches.join(' } UNION { ')} }`;
  return [
    `CONSTRUCT { ?z ?p ?o } WHERE { ${where} ?z ?p ?o . }`,
    `CONSTRUCT { ?s ?p ?z } WHERE { ${where} ?s ?p ?z . }`,
  ];
}

/**
 * RDF-star post-pass over the wire: for every described quad with a named-node
 * subject, ask the endpoint for annotations whose quoted triple is that quad.
 * Best-effort — an endpoint without RDF-star support fails the query, which we
 * treat as "no annotations". (Described quads with blank-node or quoted-triple
 * subjects cannot be pinned down in `VALUES`, so they are skipped.)
 */
async function fetchAnnotations(
  run: (q: string) => Promise<Quad[]>,
  quads: ReadonlyArray<Quad>,
): Promise<Quad[]> {
  const rows: string[] = [];
  for (const q of quads) {
    if (q.subject.termType !== 'NamedNode') continue;
    const row = tripleRow(q);
    if (row !== undefined) rows.push(row);
  }
  if (rows.length === 0) return [];
  const out: Quad[] = [];
  for (let i = 0; i < rows.length; i += POST_PASS_BATCH) {
    const batch = rows.slice(i, i + POST_PASS_BATCH);
    const query =
      `CONSTRUCT { << ?s ?p ?o >> ?ap ?ao } WHERE { ` +
      `VALUES (?s ?p ?o) { ${batch.join(' ')} } << ?s ?p ?o >> ?ap ?ao . }`;
    try {
      out.push(...(await run(query)));
    } catch {
      return out;
    }
  }
  return out;
}

function tripleRow(q: Quad): string | undefined {
  const s = termToSparql(q.subject);
  const p = termToSparql(q.predicate);
  const o = termToSparql(q.object);
  if (s === undefined || p === undefined || o === undefined) return undefined;
  return `( ${s} ${p} ${o} )`;
}

function termToSparql(t: Term): string | undefined {
  if (t.termType === 'NamedNode') return `<${t.value}>`;
  if (t.termType === 'Literal') {
    const lit = t as Literal;
    const lex = `"${escapeLiteral(lit.value)}"`;
    if (lit.language) return `${lex}@${lit.language}`;
    const dt = lit.datatype.value;
    if (dt === '' || dt === XSD_STRING) return lex;
    return `${lex}^^<${dt}>`;
  }
  return undefined;
}

function escapeLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}
