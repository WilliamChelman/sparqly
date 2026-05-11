import type { NamedNode, Quad, Store } from 'n3';

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
 * Step 1 of the describe algorithm contract (ADR-0015): emit every quad whose
 * subject or object equals the seed IRI. Bnode-chain fixpoint and the RDF-star
 * post-pass are intentionally not yet implemented — this is the tracer-bullet
 * slice (issue #185).
 */
export function describeStore(
  options: DescribeStoreOptions,
): DescribeStoreResult {
  const { store, seed } = options;
  const collected = new Set<Quad>();
  for (const q of store.match(seed, null, null, null)) {
    collected.add(q as Quad);
  }
  for (const q of store.match(null, null, seed, null)) {
    collected.add(q as Quad);
  }
  return { quads: [...collected], truncated: false };
}
