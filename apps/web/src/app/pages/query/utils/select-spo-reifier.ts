import type { SelectResult, Triple } from '@app/core';

const SPO = ['s', 'p', 'o'] as const;
const SPOG = ['s', 'p', 'o', 'g'] as const;

export function reifySelectSpo(result: SelectResult): Triple[] | null {
  const vars = result.variables;
  const isSpo = matchesVariableSet(vars, SPO);
  const isSpog = matchesVariableSet(vars, SPOG);
  if (!isSpo && !isSpog) return null;

  const out: Triple[] = [];
  for (const row of result.bindings) {
    const s = row['s'];
    const p = row['p'];
    const o = row['o'];
    if (!s || !p || !o) continue;
    if (p.termType !== 'NamedNode') continue;
    if (s.termType !== 'NamedNode' && s.termType !== 'BlankNode') continue;
    if (isSpog) {
      const g = row['g'];
      if (!g) continue;
      if (g.termType !== 'NamedNode' && g.termType !== 'BlankNode') continue;
      out.push({ subject: s, predicate: p, object: o, graph: g });
    } else {
      out.push({ subject: s, predicate: p, object: o });
    }
  }
  return out;
}

function matchesVariableSet(
  variables: ReadonlyArray<string>,
  expected: ReadonlyArray<string>,
): boolean {
  if (variables.length !== expected.length) return false;
  const seen = new Set(variables);
  if (seen.size !== expected.length) return false;
  return expected.every((v) => seen.has(v));
}
