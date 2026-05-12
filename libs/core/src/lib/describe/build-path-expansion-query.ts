import type { PathStep } from 'common';

/**
 * Build the `CONSTRUCT` that walks an explicit, predicate-pinned blank-node
 * path one hop further from the seed and emits the terminal node's quads in
 * both directions (ADR-0019).
 *
 * For `path = [p1, p2, …, pN]` the `WHERE` chains
 * `<seed> <p1> ?m1 . FILTER(isBlank(?m1)) ?m1 <p2> ?m2 . FILTER(isBlank(?m2)) …`
 * — with `?mk <pk> ?m(k-1)` instead of `?m(k-1) <pk> ?mk` for any step whose
 * `inverse` is `true` — then unions the terminal node's outgoing and incoming
 * triples (`{ ?mN ?p ?o } UNION { ?s ?p ?mN }`). Every predicate from the path
 * is pinned; nothing is an unbound property path. The empty path is valid and
 * degenerates to the seed's own quads in both directions.
 */
export function buildPathExpansionQuery(
  seedIri: string,
  path: ReadonlyArray<PathStep>,
): string {
  const where: string[] = [];
  let node = `<${seedIri}>`;
  path.forEach((step, i) => {
    const next = `?m${i + 1}`;
    const p = `<${step.predicate}>`;
    where.push(step.inverse ? `${next} ${p} ${node} .` : `${node} ${p} ${next} .`);
    where.push(`FILTER(isBlank(${next}))`);
    node = next;
  });
  where.push(`{ ${node} ?eop ?eoo } UNION { ?eis ?eip ${node} }`);
  return (
    `CONSTRUCT { ${node} ?eop ?eoo . ?eis ?eip ${node} } ` +
    `WHERE { ${where.join(' ')} }`
  );
}
