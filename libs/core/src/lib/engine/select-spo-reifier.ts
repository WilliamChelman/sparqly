import type * as RDF from '@rdfjs/types';
import { DataFactory } from 'n3';

const { quad, defaultGraph } = DataFactory;

const SPO = ['s', 'p', 'o'] as const;
const SPOG = ['s', 'p', 'o', 'g'] as const;

export interface ReifyTripleShapedBindingsInput {
  variables: ReadonlyArray<string>;
  bindings: ReadonlyArray<Record<string, RDF.Term | undefined>>;
}

export function reifyTripleShapedBindings(
  input: ReifyTripleShapedBindingsInput,
): RDF.Quad[] | null {
  const isSpo = matchesVariableSet(input.variables, SPO);
  const isSpog = !isSpo && matchesVariableSet(input.variables, SPOG);
  if (!isSpo && !isSpog) return null;
  const out: RDF.Quad[] = [];
  for (const r of input.bindings) {
    const s = r['s'];
    const p = r['p'];
    const o = r['o'];
    if (!s || !p || !o) continue;
    if (p.termType !== 'NamedNode') continue;
    if (s.termType !== 'NamedNode' && s.termType !== 'BlankNode') continue;
    let graph: RDF.Quad_Graph = defaultGraph();
    if (isSpog) {
      const g = r['g'];
      if (g !== undefined) {
        if (g.termType !== 'NamedNode' && g.termType !== 'BlankNode') continue;
        graph = g;
      }
    }
    out.push(
      quad(
        s as RDF.Quad_Subject,
        p,
        o as RDF.Quad_Object,
        graph,
      ),
    );
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
