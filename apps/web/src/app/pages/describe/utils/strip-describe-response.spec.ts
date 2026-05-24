import { describe, expect, it } from 'vitest';
import { DataFactory } from 'n3';
import { describeProvenance, serializeDescribeWire } from 'common';
import {
  FROM_SOURCE_PREDICATE,
  stripDescribeResponse,
} from './strip-describe-response';

const { namedNode, quad } = DataFactory;

const SEED = 'http://example.org/alice';
const BOB = 'http://example.org/bob';
const KNOWS = 'http://example.org/knows';

function quadKey(s: string, p: string, o: string): string {
  return `NamedNode:${s} NamedNode:${p} NamedNode:${o} DefaultGraph:`;
}

describe('stripDescribeResponse', () => {
  it('returns empty quads + empty origins map when the response is null', () => {
    const { quads, originsByQuad } = stripDescribeResponse(null);
    expect(quads).toEqual([]);
    expect(originsByQuad.size).toBe(0);
  });

  it('returns empty quads + empty origins map when the wire payload is whitespace', () => {
    const { quads, originsByQuad } = stripDescribeResponse({
      iri: SEED,
      quads: '   \n\t  ',
      total: 0,
      perSource: {},
    });
    expect(quads).toEqual([]);
    expect(originsByQuad.size).toBe(0);
  });

  it('strips fromSource annotations into the originsByQuad map and leaves only asserted quads', () => {
    const asserted = quad(namedNode(SEED), namedNode(KNOWS), namedNode(BOB));
    const wire = serializeDescribeWire(
      describeProvenance.inject([asserted], 'alpha', FROM_SOURCE_PREDICATE),
    );
    const { quads, originsByQuad } = stripDescribeResponse({
      iri: SEED,
      quads: wire,
      total: 1,
      perSource: { alpha: { count: 1, truncated: false } },
    });
    expect(quads.length).toBe(1);
    expect(quads[0].subject.value).toBe(SEED);
    expect(quads[0].predicate.value).toBe(KNOWS);
    expect(quads[0].object.value).toBe(BOB);
    expect(originsByQuad.get(quadKey(SEED, KNOWS, BOB))).toEqual(['alpha']);
  });

  it('collects multiple origins for the same quad across sources', () => {
    const asserted = quad(namedNode(SEED), namedNode(KNOWS), namedNode(BOB));
    const merged = [
      ...describeProvenance.inject([asserted], 'alpha', FROM_SOURCE_PREDICATE),
      ...describeProvenance
        .inject([asserted], 'beta', FROM_SOURCE_PREDICATE)
        .slice(1),
    ];
    const wire = serializeDescribeWire(merged);
    const { quads, originsByQuad } = stripDescribeResponse({
      iri: SEED,
      quads: wire,
      total: 1,
      perSource: {
        alpha: { count: 1, truncated: false },
        beta: { count: 1, truncated: false },
      },
    });
    expect(quads.length).toBe(1);
    const origins = originsByQuad.get(quadKey(SEED, KNOWS, BOB)) ?? [];
    expect([...origins].sort()).toEqual(['alpha', 'beta']);
  });
});
