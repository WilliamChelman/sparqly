import { parseDescribeWire, type PathStep } from 'common';
import {
  DataFactory,
  Store,
  type Literal,
  type NamedNode,
  type Quad,
  type Term,
} from 'n3';
import { describeStore } from './describe-store';
import { buildPathExpansionQuery } from './build-path-expansion-query';
import {
  DEFAULT_ENDPOINT_TIMEOUT_MS,
  collectInjectedHeaders,
  describeEndpointError,
  parseSparqlResultsJson,
  type SparqlBinding,
} from '../engine';
import type { ParsedEndpointSource } from '../sources';

const { quad: makeQuad, defaultGraph } = DataFactory;

/** Quoted triples per RDF-star post-pass query. */
const POST_PASS_BATCH = 50;
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

const SELECT_ACCEPT = 'application/sparql-results+json';
const CONSTRUCT_ACCEPT =
  'application/n-quads, application/n-triples;q=0.9, text/turtle;q=0.5';

export interface DescribeEndpointOptions {
  endpoint: ParsedEndpointSource;
  seed: NamedNode;
  perSourceLimit: number;
  /**
   * UI-driven blank-node expansion paths (ADR-0019). Each path is walked one
   * blank-node hop further from the seed via {@link buildPathExpansionQuery}
   * and its quads unioned into the depth-0 description before pruning. Defaults
   * to no paths (depth-0).
   */
  paths?: PathStep[][];
}

export interface DescribeEndpointResult {
  quads: Quad[];
  truncated: boolean;
}

/**
 * Describe a seed IRI against a remote SPARQL endpoint — depth-0 (ADR-0019),
 * quad-aware (ADR-0023).
 *
 * Fetches only the seed's direct quads via two graph-aware `SELECT`s — one for
 * outgoing edges (`{ <seed> ?p ?o } UNION { GRAPH ?g { <seed> ?p ?o } }`) and
 * one for incoming (`{ ?s ?p <seed> } UNION { GRAPH ?g { ?s ?p <seed> } }`),
 * kept as two queries rather than a single `UNION` as `SQ142` insurance —
 * reconstructs each row into a quad carrying its real named graph (or the
 * default graph), plus the existing best-effort RDF-star post-pass (a
 * `CONSTRUCT`) over the small result. On endpoints whose default graph is the
 * merge of every named graph, a triple comes back both with `?g` unbound and
 * with `?g` bound; {@link preferNamedGraphs} keeps only the named-graph copy.
 * The quads are loaded into a fresh `Store`, pruned by {@link describeStore}
 * (which here adds nothing past the fetched quads — blank nodes come back
 * dangling), and capped at `perSourceLimit`.
 *
 * Unlike {@link describeStore} this is *not* a blank-node fixpoint: chasing the
 * chain deeper is an explicit UI gesture, carried by {@link PathStep} `paths`
 * (one extra query per path). The result is `truncated` when the cap fired, an
 * edge direction or path query failed, or any dangling blank node remains.
 */
export async function describeEndpoint(
  options: DescribeEndpointOptions,
): Promise<DescribeEndpointResult> {
  const { endpoint, seed, perSourceLimit, paths = [] } = options;
  const selectRows = makeRunner(endpoint, SELECT_ACCEPT, parseSparqlResultsJson);
  const construct = makeRunner(endpoint, CONSTRUCT_ACCEPT, parseDescribeWire);
  const s = `<${seed.value}>`;

  const direct = await fetchBothDirections(
    selectRows(
      `SELECT ?p ?o ?g WHERE { { ${s} ?p ?o } UNION { GRAPH ?g { ${s} ?p ?o } } }`,
    ).then((rows) =>
      rows.flatMap((r) =>
        r['p'] && r['o'] ? [quadOf(seed, r['p'], r['o'], r['g'])] : [],
      ),
    ),
    selectRows(
      `SELECT ?s ?p ?g WHERE { { ?s ?p ${s} } UNION { GRAPH ?g { ?s ?p ${s} } } }`,
    ).then((rows) =>
      rows.flatMap((r) =>
        r['s'] && r['p'] ? [quadOf(r['s'], r['p'], seed, r['g'])] : [],
      ),
    ),
  );
  const expanded = await fetchPathExpansions(selectRows, seed.value, paths);

  const store = new Store();
  store.addQuads(preferNamedGraphs([...direct.quads, ...expanded.quads]));
  let desc = describeStore({ store, seed, perSourceLimit });

  const annotations = await fetchAnnotations(construct, desc.quads);
  if (annotations.length > 0) {
    const merged = new Store();
    merged.addQuads(desc.quads);
    merged.addQuads(annotations);
    desc = describeStore({ store: merged, seed, perSourceLimit });
  }

  const truncated =
    desc.truncated ||
    direct.partial ||
    expanded.partial ||
    hasBlankNode(desc.quads);
  return { quads: desc.quads, truncated };
}

/** Build a quad from `SELECT` bindings, defaulting an unbound graph to the default graph. */
function quadOf(
  subject: Term,
  predicate: Term | undefined,
  object: Term | undefined,
  graph: Term | undefined,
): Quad {
  return makeQuad(
    subject as Quad['subject'],
    predicate as Quad['predicate'],
    object as Quad['object'],
    (graph ?? defaultGraph()) as Quad['graph'],
  ) as Quad;
}

/**
 * Drop default-graph quads whose `(s, p, o)` also appears in some named graph.
 * On endpoints that union every named graph into the default graph the seed's
 * triples come back twice — once with `?g` unbound (from the union default),
 * once per named graph it's in — and the named-graph copy is the truthful one.
 * Distinct named graphs are kept distinct; quads with no named-graph twin pass
 * through untouched.
 */
function preferNamedGraphs(quads: ReadonlyArray<Quad>): Quad[] {
  const inNamed = new Set<string>();
  for (const q of quads) {
    if (q.graph.termType !== 'DefaultGraph') inNamed.add(tripleKey(q));
  }
  return quads.filter(
    (q) => !(q.graph.termType === 'DefaultGraph' && inNamed.has(tripleKey(q))),
  );
}

function tripleKey(q: { subject: Term; predicate: Term; object: Term }): string {
  return `${termKey(q.subject)} ${termKey(q.predicate)} ${termKey(q.object)}`;
}

function termKey(t: Term): string {
  if ((t.termType as string) === 'Quad') {
    return `<<${tripleKey(t as unknown as Quad)} ${termKey((t as unknown as Quad).graph)}>>`;
  }
  return `${t.termType}:${t.value}`;
}

/**
 * Walk each requested path one blank-node hop further from the seed and gather
 * the terminal nodes' quads. Best-effort per path — a path query that fails
 * flags `partial` (→ `truncated`) without sinking the rest of the description.
 */
async function fetchPathExpansions(
  selectRows: (q: string) => Promise<SparqlBinding[]>,
  seedIri: string,
  paths: ReadonlyArray<PathStep[]>,
): Promise<{ quads: Quad[]; partial: boolean }> {
  if (paths.length === 0) return { quads: [], partial: false };
  const results = await Promise.allSettled(
    paths.map((path) =>
      selectRows(buildPathExpansionQuery(seedIri, path)).then(
        expansionRowsToQuads,
      ),
    ),
  );
  const quads: Quad[] = [];
  let partial = false;
  for (const r of results) {
    if (r.status === 'fulfilled') quads.push(...r.value);
    else partial = true;
  }
  return { quads, partial };
}

/**
 * Rebuild quads from a {@link buildPathExpansionQuery} result. Each row binds
 * `?node` (the terminal node) plus, depending on the `UNION` branch, either the
 * outgoing trio `?eop ?eoo [?eg]` or the incoming trio `?eis ?eip [?eig]`.
 */
function expansionRowsToQuads(rows: SparqlBinding[]): Quad[] {
  const out: Quad[] = [];
  for (const r of rows) {
    const node = r['node'];
    if (!node) continue;
    if (r['eop'] && r['eoo']) out.push(quadOf(node, r['eop'], r['eoo'], r['eg']));
    if (r['eis'] && r['eip']) out.push(quadOf(r['eis'], r['eip'], node, r['eig']));
  }
  return out;
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

function makeRunner<T>(
  endpoint: ParsedEndpointSource,
  accept: string,
  parse: (text: string) => T,
): (query: string) => Promise<T> {
  const timeoutMs = endpoint.timeoutMs ?? DEFAULT_ENDPOINT_TIMEOUT_MS;
  const headers: Record<string, string> = {
    ...collectInjectedHeaders(endpoint),
    'Content-Type': 'application/sparql-query',
    Accept: accept,
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
      return parse(await res.text());
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
  const seen = new Set<string>();
  for (const q of quads) {
    if (q.subject.termType !== 'NamedNode') continue;
    const row = tripleRow(q);
    if (row !== undefined && !seen.has(row)) {
      seen.add(row);
      rows.push(row);
    }
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
