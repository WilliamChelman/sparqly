import { bestPrefixEntryFor } from 'common';

export function curieOrIri(
  iri: string,
  entries: ReadonlyArray<[string, string]>,
  base: string | undefined,
): string {
  const match = bestPrefixEntryFor(iri, entries);
  if (match !== undefined) {
    const [name, ns] = match;
    return `${name}:${iri.slice(ns.length)}`;
  }
  if (base !== undefined && iri.startsWith(base)) {
    return `<${iri.slice(base.length)}>`;
  }
  return `<${iri}>`;
}

/**
 * Shorten a serialized object term (as produced by `serializeObject` in
 * group-rdf-diff-by-entity): `<iri>` → CURIE, literals get their datatype
 * IRI shortened, bnodes pass through.
 */
export function shortenObjectTerm(
  term: string,
  entries: ReadonlyArray<[string, string]>,
  base: string | undefined,
): string {
  if (term.startsWith('<') && term.endsWith('>')) {
    return curieOrIri(term.slice(1, -1), entries, base);
  }
  const dtMatch = /\^\^<([^>]+)>$/.exec(term);
  if (dtMatch) {
    const dtIri = dtMatch[1];
    const lex = term.slice(0, dtMatch.index);
    return `${lex}^^${curieOrIri(dtIri, entries, base)}`;
  }
  return term;
}
