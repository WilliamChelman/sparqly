import type { Term } from 'n3';

/**
 * Distinct value used in the bag-key when a SELECT projection variable is
 * unbound for a row. Surfaces as `?var=UNBOUND` in the key serialization;
 * chosen to be lexically un-confusable with a serialized RDF term (which
 * always begins with `<`, `"`, or `_:`).
 */
export const UNBOUND_SENTINEL = 'UNBOUND';

export type TabularRow = Record<string, Term | undefined>;

/**
 * Build a stable bag-key for one bindings row. Variables are emitted in
 * variable-name order (alphabetical) so two callers passing the same
 * `variables` array in different orders get the same key — the bag's
 * identity is defined by the projection's *set* of names.
 *
 * Term serialization mirrors graph-diff's lexical encoding (no value-equality
 * collapsing): `"30"^^xsd:integer` and `"30"^^xsd:int` are distinct keys.
 */
export function tabularRowKey(
  row: TabularRow,
  variables: ReadonlyArray<string>,
): string {
  const sorted = [...variables].sort();
  const parts: string[] = [];
  for (const name of sorted) {
    parts.push(`?${name}=${serializeTerm(row[name])}`);
  }
  return parts.join(' ');
}

function serializeTerm(term: Term | undefined): string {
  if (term === undefined) return UNBOUND_SENTINEL;
  if (term.termType === 'NamedNode') return `<${term.value}>`;
  if (term.termType === 'BlankNode') return `_:${term.value}`;
  if (term.termType === 'Literal') {
    const lit = term as Term & {
      language?: string;
      datatype?: { value: string };
    };
    const lex = `"${escapeLiteral(term.value)}"`;
    if (lit.language && lit.language.length > 0) return `${lex}@${lit.language}`;
    if (
      lit.datatype &&
      lit.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string'
    ) {
      return `${lex}^^<${lit.datatype.value}>`;
    }
    return lex;
  }
  return term.value;
}

function escapeLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}
