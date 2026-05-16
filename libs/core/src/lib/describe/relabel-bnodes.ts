import { DataFactory, type Quad, type Term } from 'n3';

const { blankNode, quad: makeQuad } = DataFactory;

/**
 * Deterministic per-source bnode-label rewrite (Describe bnode rewrite,
 * ADR-0015, CONTEXT.md). Returns a new quad list where every blank node's
 * label is rewritten to `${prefix}__${originalLabel}`. Co-references are
 * preserved (same input label maps to the same output label). Quoted-triple
 * subjects (RDF-star) are rewritten recursively. Non-bnode terms are returned
 * verbatim.
 *
 * The rewrite is a cheap label-prefix pass — *not* RDFC-1.0 canonicalization
 * (which `canonicalize`/`hash` use). Its sole purpose is to give per-source
 * quad streams disjoint bnode label spaces so a downstream lexical
 * `(s, p, o, g)` dedup is correct: IRI-only quads collapse across sources;
 * bnode-containing quads never collapse.
 */
export function relabelBnodes(
  quads: ReadonlyArray<Quad>,
  prefix: string,
): Quad[] {
  const safePrefix = sanitizeBnodePrefix(prefix);
  return quads.map((q) => rewriteQuad(q, safePrefix));
}

/**
 * Replace every character outside the N-Triples PN_CHARS-safe subset
 * ([A-Za-z0-9_.-]) with `_`. Source ids like `data/era-ontology.ttl`
 * (split-glob children) would otherwise produce bnode labels that cannot
 * round-trip through N-Triples serialization (the describe-API wire format).
 */
function sanitizeBnodePrefix(prefix: string): string {
  return prefix.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function rewriteQuad(q: Quad, prefix: string): Quad {
  return makeQuad(
    rewriteTerm(q.subject, prefix) as Quad['subject'],
    q.predicate,
    rewriteTerm(q.object, prefix) as Quad['object'],
    rewriteTerm(q.graph, prefix) as Quad['graph'],
  ) as Quad;
}

function rewriteTerm(t: Term, prefix: string): Term {
  if (t.termType === 'BlankNode') {
    return blankNode(`${prefix}__${t.value}`);
  }
  if ((t.termType as string) === 'Quad') {
    return rewriteQuad(t as unknown as Quad, prefix) as unknown as Term;
  }
  return t;
}
