import { Writer, type Quad, type Term } from 'n3';

export type FormatSerialization = 'turtle' | 'trig';

export interface ResolvedFormatterConfig {
  prefixes: Record<string, string>;
  base?: string;
}

const SERIALIZATION_TO_FORMAT: Record<FormatSerialization, string> = {
  turtle: 'text/turtle',
  trig: 'application/trig',
};

export function formatRdf(
  quads: Iterable<Quad>,
  serialization: FormatSerialization,
  config: ResolvedFormatterConfig,
): string {
  const list = Array.from(quads);
  if (list.length === 0) return '';

  const usedPrefixes = pickUsedPrefixes(list, config.prefixes);
  const sorted = [...list].sort(compareQuads);

  const writer = new Writer({
    format: SERIALIZATION_TO_FORMAT[serialization],
    prefixes: usedPrefixes,
    baseIRI: config.base,
  });
  for (const q of sorted) writer.addQuad(q);

  let body = '';
  writer.end((error, result) => {
    if (error) throw error;
    body = result;
  });
  return config.base ? `@base <${config.base}>.\n${body}` : body;
}

function pickUsedPrefixes(
  quads: ReadonlyArray<Quad>,
  prefixes: Record<string, string>,
): Record<string, string> {
  const entries = Object.entries(prefixes);
  if (entries.length === 0) return {};

  const usedNames = new Set<string>();
  for (const q of quads) {
    for (const term of [q.subject, q.predicate, q.object, q.graph]) {
      const name = bestPrefixFor(term, entries);
      if (name) usedNames.add(name);
    }
  }

  const out: Record<string, string> = {};
  for (const [name, iri] of entries) {
    if (usedNames.has(name)) out[name] = iri;
  }
  return out;
}

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

function compareQuads(a: Quad, b: Quad): number {
  return (
    compareTerm(a.graph, b.graph) ||
    compareTerm(a.subject, b.subject) ||
    comparePredicate(a.predicate, b.predicate) ||
    compareTerm(a.object, b.object)
  );
}

function comparePredicate(a: Term, b: Term): number {
  const aIsType = a.termType === 'NamedNode' && a.value === RDF_TYPE;
  const bIsType = b.termType === 'NamedNode' && b.value === RDF_TYPE;
  if (aIsType && !bIsType) return -1;
  if (!aIsType && bIsType) return 1;
  return compareTerm(a, b);
}

function compareTerm(a: Term, b: Term): number {
  const aKey = termKey(a);
  const bKey = termKey(b);
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}

function termKey(term: Term): string {
  switch (term.termType) {
    case 'DefaultGraph':
      return '0:';
    case 'NamedNode':
      return `1:${term.value}`;
    case 'BlankNode':
      return `2:${term.value}`;
    case 'Literal': {
      const lit = term as Term & {
        language?: string;
        datatype?: { value: string };
      };
      return `3:${term.value}${lit.datatype?.value ?? ''}${lit.language ?? ''}`;
    }
    default:
      return `9:${term.value}`;
  }
}

function bestPrefixFor(
  term: Term,
  entries: ReadonlyArray<[string, string]>,
): string | undefined {
  if (term.termType !== 'NamedNode') return undefined;
  const iri = term.value;
  let bestName: string | undefined;
  let bestLength = -1;
  for (const [name, prefIri] of entries) {
    if (iri.startsWith(prefIri) && prefIri.length > bestLength) {
      bestName = name;
      bestLength = prefIri.length;
    }
  }
  return bestName;
}
