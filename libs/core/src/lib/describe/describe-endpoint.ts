import { parseDescribeWire } from 'common';
import { Store, type Literal, type NamedNode, type Quad, type Term } from 'n3';
import { describeStore } from './describe-store';
import {
  DEFAULT_ENDPOINT_TIMEOUT_MS,
  collectInjectedHeaders,
  describeEndpointError,
} from '../engine';
import type { ParsedEndpointSource } from '../sources';

/** Quoted triples per RDF-star post-pass query. */
const POST_PASS_BATCH = 50;
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

/** One hop of a UI-driven blank-node expansion path from the seed (ADR-0019). */
export interface PathStep {
  predicate: string;
  inverse: boolean;
}

export interface DescribeEndpointOptions {
  endpoint: ParsedEndpointSource;
  seed: NamedNode;
  perSourceLimit: number;
  /**
   * UI-driven blank-node expansion paths (ADR-0019). Wired through but inert
   * until the path-expansion slice lands; defaults to no paths (depth-0).
   */
  paths?: PathStep[][];
}

export interface DescribeEndpointResult {
  quads: Quad[];
  truncated: boolean;
}

/**
 * Describe a seed IRI against a remote SPARQL endpoint — depth-0 (ADR-0019).
 *
 * Fetches only the seed's direct quads: one `CONSTRUCT` for outgoing edges
 * (`<seed> ?p ?o`) and one for incoming edges (`?s ?p <seed>`), kept as two
 * queries rather than a single `UNION` as `SQ142` insurance, plus the existing
 * best-effort RDF-star post-pass over the small result. The responses are
 * loaded into a fresh `Store`, pruned by {@link describeStore} (which here adds
 * nothing past the fetched quads — blank nodes come back dangling), and capped
 * at `perSourceLimit`.
 *
 * Unlike {@link describeStore} this is *not* a blank-node fixpoint: chasing the
 * chain deeper is an explicit UI gesture, carried by {@link PathStep} paths
 * (inert for now). The result is `truncated` when the cap fired, an edge
 * direction failed, or any dangling blank node remains.
 */
export async function describeEndpoint(
  options: DescribeEndpointOptions,
): Promise<DescribeEndpointResult> {
  const { endpoint, seed, perSourceLimit } = options;
  const run = makeConstructRunner(endpoint);
  const s = `<${seed.value}>`;

  const direct = await fetchBothDirections(
    run(`CONSTRUCT { ${s} ?p ?o } WHERE { ${s} ?p ?o . }`),
    run(`CONSTRUCT { ?s ?p ${s} } WHERE { ?s ?p ${s} . }`),
  );

  const store = new Store();
  store.addQuads(direct.quads);
  let desc = describeStore({ store, seed, perSourceLimit });

  const annotations = await fetchAnnotations(run, desc.quads);
  if (annotations.length > 0) {
    const merged = new Store();
    merged.addQuads(desc.quads);
    merged.addQuads(annotations);
    desc = describeStore({ store: merged, seed, perSourceLimit });
  }

  const truncated =
    desc.truncated || direct.partial || hasBlankNode(desc.quads);
  return { quads: desc.quads, truncated };
}

/**
 * Await both edge-direction queries. If one rejects while the other resolves,
 * return the partial result flagged `partial`; only a double failure throws.
 */
async function fetchBothDirections(
  outgoing: Promise<Quad[]>,
  incoming: Promise<Quad[]>,
): Promise<{ quads: Quad[]; partial: boolean }> {
  const [out, inc] = await Promise.allSettled([outgoing, incoming]);
  const quads: Quad[] = [];
  let fulfilled = 0;
  let partial = false;
  for (const r of [out, inc]) {
    if (r.status === 'fulfilled') {
      quads.push(...r.value);
      fulfilled += 1;
    } else {
      partial = true;
    }
  }
  if (fulfilled === 0) {
    throw (out as PromiseRejectedResult).reason ??
      (inc as PromiseRejectedResult).reason;
  }
  return { quads, partial };
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
