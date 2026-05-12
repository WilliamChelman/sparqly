import { DataFactory, type Term } from 'n3';

const { namedNode, literal, blankNode, quad, defaultGraph } = DataFactory;

/** One row of a `SELECT` result: variable name → RDF term. Unbound variables are absent. */
export type SparqlBinding = Record<string, Term>;

interface RawTriple {
  subject: RawTerm;
  predicate: RawTerm;
  object: RawTerm;
}

interface RawTerm {
  type: 'uri' | 'literal' | 'typed-literal' | 'bnode' | 'triple';
  value: string | RawTriple;
  'xml:lang'?: string;
  datatype?: string;
}

/**
 * Parse a SPARQL 1.1 `application/sparql-results+json` document into rows of
 * n3 {@link Term}s. Handles the four term kinds plus RDF-star `triple` terms
 * (SPARQL 1.2). Boolean/`ASK` results have no `results.bindings`, so they parse
 * to an empty array.
 */
export function parseSparqlResultsJson(text: string): SparqlBinding[] {
  const json = JSON.parse(text) as {
    results?: { bindings?: Array<Record<string, RawTerm>> };
  };
  const rows = json.results?.bindings ?? [];
  return rows.map((row) => {
    const out: SparqlBinding = {};
    for (const [name, raw] of Object.entries(row)) out[name] = termFromRaw(raw);
    return out;
  });
}

function termFromRaw(raw: RawTerm): Term {
  switch (raw.type) {
    case 'uri':
      return namedNode(raw.value as string);
    case 'bnode':
      return blankNode(raw.value as string);
    case 'triple': {
      const t = raw.value as RawTriple;
      return quad(
        termFromRaw(t.subject) as never,
        termFromRaw(t.predicate) as never,
        termFromRaw(t.object) as never,
        defaultGraph(),
      ) as unknown as Term;
    }
    default: {
      const v = raw.value as string;
      if (raw['xml:lang']) return literal(v, raw['xml:lang']);
      if (raw.datatype) return literal(v, namedNode(raw.datatype));
      return literal(v);
    }
  }
}
