import { DataFactory, type Quad, type Store } from 'n3';
import type { BnodePathStep } from './group-rdf-diff-by-entity';
import { bnodeStepFor, synthesizeOrphanAnchor } from './subject-path';

export interface ResolvedAnchor {
  anchor: string;
  /** Empty when subject is the named anchor itself. */
  bnodePath: BnodePathStep[];
  /** True when this anchor was synthesized from an orphan bnode tree. */
  orphan: boolean;
}

export function resolveAnchors(
  q: Quad,
  store: Store,
  inverseCanonicalIdMap: Map<string, string> | undefined,
  forwardCanonicalIdMap: Map<string, string> | undefined,
): ResolvedAnchor[] {
  if (q.subject.termType === 'NamedNode') {
    return [{ anchor: q.subject.value, bnodePath: [], orphan: false }];
  }
  if (q.subject.termType !== 'BlankNode') return [];
  if (inverseCanonicalIdMap === undefined) return [];
  // The diff exposes canonical bnode labels (e.g. `c14n0`); walk the parent
  // chain in the side's raw Store, where bnodes carry their original parser
  // labels. Map canonical → raw via the inverted canonicalIdMap.
  const canonicalLabel = q.subject.value;
  const rawLabel = inverseCanonicalIdMap.get(canonicalLabel);
  if (rawLabel === undefined) return [];
  const named = findAllNamedAncestors(rawLabel, store);
  if (named.length > 0) return named;
  // No named ancestor — synthesize an orphan anchor on the bnode tree's root
  // canonical label so the changes surface rather than getting silently
  // dropped.
  const orphan = synthesizeOrphanAnchor(rawLabel, store, forwardCanonicalIdMap);
  return orphan === undefined
    ? []
    : [{ anchor: orphan, bnodePath: [], orphan: true }];
}

function findAllNamedAncestors(
  startRawLabel: string,
  store: Store,
): ResolvedAnchor[] {
  // BFS upward through the bnode parent chain, collecting every distinct
  // named ancestor reachable from the start bnode. For the multi-parent case
  // (a bnode reachable from two or more named parents) we emit one anchor per
  // named ancestor; the caller duplicates the line under each.
  const results = new Map<string, ResolvedAnchor>();
  // Each frame: (currentRawLabel, reversedHops-so-far, set-of-visited-on-this-path).
  // We track visited per-path so independent paths upward can share bnodes
  // without one short-circuiting the other.
  const queue: Array<{
    current: string;
    reversedHops: BnodePathStep[];
    visited: Set<string>;
  }> = [{ current: startRawLabel, reversedHops: [], visited: new Set() }];
  while (queue.length > 0) {
    const frame = queue.shift() as (typeof queue)[number];
    const { current, reversedHops, visited } = frame;
    if (visited.has(current)) continue;
    const nextVisited = new Set(visited);
    nextVisited.add(current);
    const incoming = store.getQuads(
      null,
      null,
      DataFactory.blankNode(current),
      null,
    );
    if (incoming.length === 0) continue;
    const step = bnodeStepFor(current, store);
    // Sort incoming for determinism: named parents lex by IRI, then bnode
    // parents lex by raw label.
    const namedParents = incoming
      .filter((qq) => qq.subject.termType === 'NamedNode')
      .sort((a, b) =>
        a.subject.value < b.subject.value
          ? -1
          : a.subject.value > b.subject.value
            ? 1
            : a.predicate.value < b.predicate.value
              ? -1
              : a.predicate.value > b.predicate.value
                ? 1
                : 0,
      );
    for (const np of namedParents) {
      const hops = [
        ...reversedHops,
        { ...step, parentPredicate: np.predicate.value },
      ];
      const path: BnodePathStep[] = [];
      for (let i = hops.length - 1; i >= 0; i--) path.push(hops[i]);
      const anchor = np.subject.value;
      // Dedup: if multiple paths lead to the same named ancestor, keep the
      // first (deterministic by BFS order + sort).
      if (!results.has(anchor)) {
        results.set(anchor, { anchor, bnodePath: path, orphan: false });
      }
    }
    const bnodeParents = incoming
      .filter((qq) => qq.subject.termType === 'BlankNode')
      .sort((a, b) =>
        a.subject.value < b.subject.value ? -1 : a.subject.value > b.subject.value ? 1 : 0,
      );
    for (const bp of bnodeParents) {
      queue.push({
        current: bp.subject.value,
        reversedHops: [
          ...reversedHops,
          { ...step, parentPredicate: bp.predicate.value },
        ],
        visited: nextVisited,
      });
    }
  }
  // Sort by anchor IRI for deterministic emission order.
  return Array.from(results.values()).sort((a, b) =>
    a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0,
  );
}
