import type { Quad } from 'n3';
import { describeProvenance, parseDescribeWire } from 'common';
import type { DescribeResponse } from '../services/describe.service';

export const FROM_SOURCE_PREDICATE = 'urn:sparqly:fromSource';

export interface StrippedDescribeResponse {
  readonly quads: readonly Quad[];
  readonly originsByQuad: ReadonlyMap<string, readonly string[]>;
}

/**
 * Decode a describe response's wire quads, then strip the per-quad
 * `urn:sparqly:fromSource` provenance annotations into an out-of-band
 * `originsByQuad` map. Empty / whitespace-only `quads` yield an empty pair.
 */
export function stripDescribeResponse(
  resp: DescribeResponse | null,
): StrippedDescribeResponse {
  if (!resp || resp.quads.trim().length === 0) {
    return { quads: [], originsByQuad: new Map() };
  }
  const all = parseDescribeWire(resp.quads);
  return describeProvenance.strip(all, FROM_SOURCE_PREDICATE);
}
