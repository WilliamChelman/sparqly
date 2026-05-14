import type { Quad, Term } from 'n3';
import { bestPrefixEntryFor } from './shorten-nquad-line';

export function pickUsedPrefixes(
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
    if (q.object.termType === 'Literal') {
      const dt = (q.object as Term & { datatype?: Term }).datatype;
      if (dt) {
        const name = bestPrefixFor(dt, entries);
        if (name) usedNames.add(name);
      }
    }
  }

  const out: Record<string, string> = {};
  for (const [name, iri] of entries) {
    if (usedNames.has(name)) out[name] = iri;
  }
  return out;
}

export function bestPrefixFor(
  term: Term,
  entries: ReadonlyArray<[string, string]>,
): string | undefined {
  if (term.termType !== 'NamedNode') return undefined;
  return bestPrefixEntryFor(term.value, entries)?.[0];
}
