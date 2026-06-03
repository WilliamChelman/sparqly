import {
  describeProvenance,
  parseDescribeWire,
  serializeDescribeWire,
} from 'common';
import type { Quad, Term } from 'n3';
import type { DescribeResponse } from '../services/describe.service';
import { FROM_SOURCE_PREDICATE } from './strip-describe-response';

/**
 * Rebuild a merged describe response with `sourceId`'s quads taken wholesale
 * from `fresh` and every other source's quads kept from `current`. Used after
 * a blank-node expand (ADR-0019, ADR-0033) so the user sees only the expanded
 * source's slice grow, while peer slices stay stable.
 *
 * The wire carries one `fromSource` annotation per (quad, origin), so each
 * source's slice is recoverable from `current` by inspecting those
 * annotations.
 */
export function mergeDescribeSourceSlice(
  current: DescribeResponse,
  sourceId: string,
  fresh: DescribeResponse,
): DescribeResponse {
  const predicate = FROM_SOURCE_PREDICATE;
  const slices = new Map<string, Map<string, Quad>>();
  const currentAll =
    current.quads.trim().length === 0 ? [] : parseDescribeWire(current.quads);
  const stripped = describeProvenance.strip(currentAll, predicate);
  for (const q of stripped.quads) {
    const key = quadKey(q);
    for (const origin of stripped.originsByQuad.get(key) ?? []) {
      if (origin === sourceId) continue;
      let m = slices.get(origin);
      if (!m) {
        m = new Map();
        slices.set(origin, m);
      }
      if (!m.has(key)) m.set(key, q);
    }
  }
  const freshAll =
    fresh.quads.trim().length === 0 ? [] : parseDescribeWire(fresh.quads);
  const freshSlice = new Map<string, Quad>();
  for (const q of describeProvenance.strip(freshAll, predicate).quads) {
    const key = quadKey(q);
    if (!freshSlice.has(key)) freshSlice.set(key, q);
  }
  slices.set(sourceId, freshSlice);

  // `slices` was populated peer-first (during the strip loop) then `sourceId`
  // (set above), so its key order reproduces the prior peers-then-named order
  // the flattened response no longer carries explicitly.
  const orderedSources = [...slices.keys()];
  const merged = new Map<string, Quad>();
  const originsByQuad = new Map<string, string[]>();
  for (const src of orderedSources) {
    const m = slices.get(src);
    if (!m) continue;
    for (const [key, q] of m) {
      if (!merged.has(key)) merged.set(key, q);
      const list = originsByQuad.get(key);
      if (list) {
        if (!list.includes(src)) list.push(src);
      } else {
        originsByQuad.set(key, [src]);
      }
    }
  }
  const annotations: Quad[] = [];
  for (const [key, q] of merged) {
    for (const origin of originsByQuad.get(key) ?? []) {
      annotations.push(
        ...describeProvenance.inject([q], origin, predicate).slice(1),
      );
    }
  }
  const quads = serializeDescribeWire([...merged.values(), ...annotations]);
  return {
    iri: current.iri,
    quads,
    total: merged.size,
    truncated: fresh.truncated,
  };
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
