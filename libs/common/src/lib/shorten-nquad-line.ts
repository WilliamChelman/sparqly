import { Parser, type Term } from 'n3';

export const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const RDF_TYPE = `${RDF_NS}type`;
export const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

export const DEFAULT_PREFIXES: Readonly<Record<string, string>> = Object.freeze({
  rdf: RDF_NS,
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
});

export interface ShortenNQuadLineConfig {
  prefixes: Record<string, string>;
  base?: string;
}

export function shortenNQuadLine(
  line: string,
  config: ShortenNQuadLineConfig,
): string {
  const trimmed = line.endsWith('\n') ? line.slice(0, -1) : line;
  const parser = new Parser({ format: 'application/n-quads' });
  let quads;
  try {
    quads = parser.parse(trimmed);
  } catch {
    return line;
  }
  if (quads.length !== 1) return line;
  const q = quads[0];
  const entries = Object.entries(config.prefixes);
  const base = config.base;
  const predicateText =
    q.predicate.termType === 'NamedNode' && q.predicate.value === RDF_TYPE
      ? 'a'
      : renderTerm(q.predicate, entries, base);
  const parts = [
    renderTerm(q.subject, entries, base),
    predicateText,
    renderTerm(q.object, entries, base),
  ];
  if (q.graph.termType !== 'DefaultGraph') {
    parts.push(renderTerm(q.graph, entries, base));
  }
  return `${parts.join(' ')} .`;
}

function renderTerm(
  term: Term,
  entries: ReadonlyArray<[string, string]>,
  base: string | undefined,
): string {
  if (term.termType === 'NamedNode') {
    const match = bestPrefixEntryFor(term.value, entries);
    if (match) {
      const [name, ns] = match;
      return `${name}:${term.value.slice(ns.length)}`;
    }
    if (base !== undefined && term.value.startsWith(base)) {
      return `<${term.value.slice(base.length)}>`;
    }
    return `<${term.value}>`;
  }
  if (term.termType === 'BlankNode') return `_:${term.value}`;
  if (term.termType === 'Literal') {
    const lit = term as Term & {
      language?: string;
      datatype?: { value: string };
    };
    const lex = `"${escapeLiteral(term.value)}"`;
    if (lit.language) return `${lex}@${lit.language}`;
    if (lit.datatype && lit.datatype.value !== XSD_STRING) {
      return `${lex}^^<${lit.datatype.value}>`;
    }
    return lex;
  }
  return `<${term.value}>`;
}

function escapeLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

export function bestPrefixEntryFor(
  iri: string,
  entries: ReadonlyArray<[string, string]>,
): [string, string] | undefined {
  let best: [string, string] | undefined;
  let bestLength = -1;
  for (const entry of entries) {
    const ns = entry[1];
    if (iri.startsWith(ns) && ns.length > bestLength) {
      best = entry;
      bestLength = ns.length;
    }
  }
  return best;
}
