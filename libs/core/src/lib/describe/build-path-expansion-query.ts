import type { PathStep } from 'common';

/**
 * Build the graph-aware `SELECT` that walks an explicit, predicate-pinned
 * blank-node path one hop further from the seed and yields the terminal node's
 * quads in both directions (ADR-0019, ADR-0023).
 *
 * For `path = [p1, p2, …, pN]` the `WHERE` chains
 * `<seed> <p1> ?m1 . FILTER(isBlank(?m1)) ?m1 <p2> ?m2 . FILTER(isBlank(?m2)) …`
 * — with `?mk <pk> ?m(k-1)` instead of `?m(k-1) <pk> ?mk` for any step whose
 * `inverse` is `true`, and the last hop's variable named `?node` — then unions
 * the terminal node's outgoing and incoming triples, each branch itself a
 * `{ … } UNION { GRAPH ?eg { … } }` so quads carry their named graph. The
 * empty path is valid and degenerates to the seed's own quads in both
 * directions (`BIND(<seed> AS ?node)`).
 *
 * The result projects `?node` (the terminal), `?eop ?eoo ?eg` (outgoing trio)
 * and `?eis ?eip ?eig` (incoming trio); each result row has exactly one trio
 * bound. Every predicate from the path is pinned; nothing is an unbound
 * property path.
 */
export function buildPathExpansionQuery(
  seedIri: string,
  path: ReadonlyArray<PathStep>,
): string {
  const where: string[] = [];
  let node = `<${seedIri}>`;
  path.forEach((step, i) => {
    const next = i === path.length - 1 ? '?node' : `?m${i + 1}`;
    const p = `<${step.predicate}>`;
    where.push(step.inverse ? `${next} ${p} ${node} .` : `${node} ${p} ${next} .`);
    where.push(`FILTER(isBlank(${next}))`);
    node = next;
  });
  if (path.length === 0) where.push(`BIND(${node} AS ?node)`);
  where.push(
    `{ { { ?node ?eop ?eoo } UNION { GRAPH ?eg { ?node ?eop ?eoo } } } ` +
      `UNION ` +
      `{ { ?eis ?eip ?node } UNION { GRAPH ?eig { ?eis ?eip ?node } } } }`,
  );
  return `SELECT ?node ?eop ?eoo ?eg ?eis ?eip ?eig WHERE { ${where.join(' ')} }`;
}
