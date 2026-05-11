import type { NamedNode, Quad, Store, Term } from 'n3';

export interface DescribeStoreOptions {
  store: Store;
  seed: NamedNode;
  perSourceLimit: number;
}

export interface DescribeStoreResult {
  quads: Quad[];
  truncated: boolean;
}

/**
 * Describe algorithm against an in-memory Store (ADR-0015, issue #186).
 * Step 1: emit every quad with the seed in s or o position.
 * Step 2: symmetric bnode-chain fixpoint — pull every quad mentioning a bnode
 *   that appears in s or o of an emitted quad; repeat until no new quads.
 * Step 3 (non-action): named IRIs are not traversed.
 * Step 4: post-pass — include any quad whose subject is a quoted triple
 *   `<<s p o g>>` iff `(s,p,o,g)` is already in the result set.
 */
export function describeStore(
  options: DescribeStoreOptions,
): DescribeStoreResult {
  const { store, seed, perSourceLimit } = options;
  const collected = new Map<string, Quad>();
  let truncated = false;
  const atCap = () => collected.size >= perSourceLimit;
  const add = (q: Quad): boolean => {
    if (atCap()) {
      truncated = true;
      return false;
    }
    const key = quadKey(q);
    if (collected.has(key)) return false;
    collected.set(key, q);
    return true;
  };

  for (const q of store.match(seed, null, null, null)) add(q as Quad);
  for (const q of store.match(null, null, seed, null)) add(q as Quad);

  const visitedBnodes = new Set<string>();
  const frontier: Term[] = [];
  const enqueueBnodes = (q: Quad) => {
    if (q.subject.termType === 'BlankNode' && !visitedBnodes.has(q.subject.value)) {
      frontier.push(q.subject);
    }
    if (q.object.termType === 'BlankNode' && !visitedBnodes.has(q.object.value)) {
      frontier.push(q.object);
    }
  };
  for (const q of collected.values()) enqueueBnodes(q);

  while (frontier.length > 0) {
    if (atCap()) {
      truncated = true;
      break;
    }
    const bnode = frontier.shift() as Term;
    if (visitedBnodes.has(bnode.value)) continue;
    visitedBnodes.add(bnode.value);
    for (const q of store.match(bnode, null, null, null)) {
      const key = quadKey(q as Quad);
      if (collected.has(key)) continue;
      if (!add(q as Quad)) break;
      enqueueBnodes(q as Quad);
    }
    for (const q of store.match(null, null, bnode, null)) {
      const key = quadKey(q as Quad);
      if (collected.has(key)) continue;
      if (!add(q as Quad)) break;
      enqueueBnodes(q as Quad);
    }
  }

  // Step 4: RDF-star annotation post-pass. Scan all quads with quoted-triple
  // subjects; include those whose quoted (s,p,o,g) is already in the result.
  const inResult = new Set(collected.keys());
  for (const q of store.match(null, null, null, null)) {
    const subj = (q as Quad).subject;
    if ((subj.termType as string) !== 'Quad') continue;
    const innerKey = quadKey(subj as unknown as Quad);
    if (!inResult.has(innerKey)) continue;
    if (!add(q as Quad)) break;
  }

  return { quads: [...collected.values()], truncated };
}

function quadKey(q: Quad): string {
  return `${termKey(q.subject)} ${termKey(q.predicate)} ${termKey(q.object)} ${termKey(q.graph)}`;
}

function termKey(t: Term): string {
  if ((t.termType as string) === 'Quad') {
    return `<<${quadKey(t as unknown as Quad)}>>`;
  }
  return `${t.termType}:${t.value}`;
}
