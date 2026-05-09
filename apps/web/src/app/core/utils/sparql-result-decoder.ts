import { Parser, type Term as N3Term } from 'n3';

export interface NamedNodeTerm {
  termType: 'NamedNode';
  value: string;
}

export interface BlankNodeTerm {
  termType: 'BlankNode';
  value: string;
}

export interface LiteralTerm {
  termType: 'Literal';
  value: string;
  language?: string;
  datatype?: { value: string };
}

export type Term = NamedNodeTerm | BlankNodeTerm | LiteralTerm;

export interface Triple {
  subject: NamedNodeTerm | BlankNodeTerm;
  predicate: NamedNodeTerm;
  object: Term;
  graph?: NamedNodeTerm | BlankNodeTerm;
}

export interface SelectResult {
  kind: 'select';
  variables: ReadonlyArray<string>;
  bindings: ReadonlyArray<Record<string, Term>>;
  raw: string;
  contentType: string;
}

export interface AskResult {
  kind: 'ask';
  value: boolean;
  raw: string;
  contentType: string;
}

export interface TripleResult {
  kind: 'triples';
  triples: ReadonlyArray<Triple>;
  raw: string;
  contentType: string;
}

export interface RawResult {
  kind: 'raw';
  raw: string;
  contentType: string;
}

export type DecodedResult =
  | SelectResult
  | AskResult
  | TripleResult
  | RawResult;

interface SparqlJsonTerm {
  type: 'uri' | 'bnode' | 'literal' | 'typed-literal';
  value: string;
  datatype?: string;
  'xml:lang'?: string;
}

const SPARQL_JSON = 'application/sparql-results+json';
const TURTLE = 'text/turtle';
const N_QUADS = 'application/n-quads';
const N_TRIPLES = 'application/n-triples';
const TRIG = 'application/trig';

export function decodeSparqlResult(
  text: string,
  contentType: string,
): DecodedResult {
  const ct = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (ct === SPARQL_JSON) {
    const decoded = decodeSparqlJson(text, contentType);
    if (decoded !== undefined) return decoded;
  }
  if (ct === TURTLE || ct === N_QUADS || ct === N_TRIPLES || ct === TRIG) {
    const decoded = decodeRdf(text, contentType, ct);
    if (decoded !== undefined) return decoded;
  }
  return { kind: 'raw', raw: text, contentType };
}

function decodeSparqlJson(
  text: string,
  contentType: string,
): SelectResult | AskResult | undefined {
  let parsed: {
    head?: { vars?: string[] };
    boolean?: boolean;
    results?: { bindings?: Array<Record<string, SparqlJsonTerm>> };
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed.boolean === 'boolean') {
    return {
      kind: 'ask',
      value: parsed.boolean,
      raw: text,
      contentType,
    };
  }
  if (parsed.results && Array.isArray(parsed.results.bindings)) {
    const head = parsed.head;
    const variables = head && Array.isArray(head.vars) ? head.vars : [];
    const bindings: Array<Record<string, Term>> = [];
    for (const row of parsed.results.bindings) {
      const out: Record<string, Term> = {};
      for (const [name, value] of Object.entries(row)) {
        const term = sparqlJsonTermToTerm(value);
        if (term !== undefined) out[name] = term;
      }
      bindings.push(out);
    }
    return {
      kind: 'select',
      variables,
      bindings,
      raw: text,
      contentType,
    };
  }
  return undefined;
}

function sparqlJsonTermToTerm(t: SparqlJsonTerm | undefined): Term | undefined {
  if (!t || typeof t !== 'object') return undefined;
  if (t.type === 'uri') return { termType: 'NamedNode', value: t.value };
  if (t.type === 'bnode') return { termType: 'BlankNode', value: t.value };
  if (t.type === 'literal' || t.type === 'typed-literal') {
    const lit: LiteralTerm = { termType: 'Literal', value: t.value };
    if (t['xml:lang']) lit.language = t['xml:lang'];
    if (t.datatype) lit.datatype = { value: t.datatype };
    return lit;
  }
  return undefined;
}

function decodeRdf(
  text: string,
  contentType: string,
  ct: string,
): TripleResult | undefined {
  const format =
    ct === TURTLE
      ? 'text/turtle'
      : ct === N_QUADS
        ? 'application/n-quads'
        : ct === N_TRIPLES
          ? 'application/n-triples'
          : 'application/trig';
  let quads;
  try {
    const parser = new Parser({ format });
    quads = parser.parse(text);
  } catch {
    return undefined;
  }
  const triples: Triple[] = [];
  for (const q of quads) {
    const subject = n3TermToSubject(q.subject);
    const predicate = n3TermToPredicate(q.predicate);
    const object = n3TermToTerm(q.object);
    if (!subject || !predicate || !object) return undefined;
    const triple: Triple = { subject, predicate, object };
    if (q.graph.termType !== 'DefaultGraph') {
      const g = n3TermToSubject(q.graph);
      if (g) triple.graph = g;
    }
    triples.push(triple);
  }
  return { kind: 'triples', triples, raw: text, contentType };
}

function n3TermToSubject(
  t: N3Term,
): NamedNodeTerm | BlankNodeTerm | undefined {
  if (t.termType === 'NamedNode') return { termType: 'NamedNode', value: t.value };
  if (t.termType === 'BlankNode') return { termType: 'BlankNode', value: t.value };
  return undefined;
}

function n3TermToPredicate(t: N3Term): NamedNodeTerm | undefined {
  if (t.termType === 'NamedNode') return { termType: 'NamedNode', value: t.value };
  return undefined;
}

function n3TermToTerm(t: N3Term): Term | undefined {
  if (t.termType === 'NamedNode') return { termType: 'NamedNode', value: t.value };
  if (t.termType === 'BlankNode') return { termType: 'BlankNode', value: t.value };
  if (t.termType === 'Literal') {
    const lit = t as N3Term & {
      language?: string;
      datatype?: { value: string };
    };
    const out: LiteralTerm = { termType: 'Literal', value: t.value };
    if (lit.language) out.language = lit.language;
    if (lit.datatype && lit.datatype.value) {
      const dt = lit.datatype.value;
      if (
        dt !== 'http://www.w3.org/2001/XMLSchema#string' &&
        dt !== 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'
      ) {
        out.datatype = { value: dt };
      }
    }
    return out;
  }
  return undefined;
}
