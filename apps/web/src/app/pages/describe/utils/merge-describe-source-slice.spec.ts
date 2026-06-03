import { describe, expect, it } from 'vitest';
import { DataFactory, type Quad } from 'n3';
import { describeProvenance, serializeDescribeWire } from 'common';
import { mergeDescribeSourceSlice } from './merge-describe-source-slice';
import {
  FROM_SOURCE_PREDICATE,
  stripDescribeResponse,
} from './strip-describe-response';
import type { DescribeResponse } from '../services/describe.service';

const { namedNode, quad } = DataFactory;

const SEED = 'http://example.org/alice';
const P = 'http://example.org/p';

function wire(quadsBySource: ReadonlyArray<[string, Quad[]]>): string {
  const out: Quad[] = [];
  for (const [src, qs] of quadsBySource) {
    if (qs.length === 0) continue;
    out.push(
      ...describeProvenance.inject(qs, src, FROM_SOURCE_PREDICATE),
    );
  }
  return serializeDescribeWire(out);
}

function buildResponse(
  quadsBySource: ReadonlyArray<[string, Quad[]]>,
): DescribeResponse {
  return {
    iri: SEED,
    quads: wire(quadsBySource),
    total: new Set(
      quadsBySource.flatMap(([, qs]) =>
        qs.map((q) => `${q.subject.value}|${q.predicate.value}|${q.object.value}`),
      ),
    ).size,
    truncated: false,
  };
}

describe('mergeDescribeSourceSlice', () => {
  it('replaces only the named source slice; peer source quads stay verbatim', () => {
    const aQuad = quad(namedNode(SEED), namedNode(P), namedNode('http://example.org/a'));
    const bQuad = quad(namedNode(SEED), namedNode(P), namedNode('http://example.org/b'));
    const cQuad = quad(namedNode(SEED), namedNode(P), namedNode('http://example.org/c'));
    const current = buildResponse([
      ['alpha', [aQuad]],
      ['beta', [bQuad]],
    ]);
    // beta's new slice no longer contains bQuad; it contains cQuad instead.
    const fresh = buildResponse([['beta', [cQuad]]]);

    const merged = mergeDescribeSourceSlice(current, 'beta', fresh);
    const { quads, originsByQuad } = stripDescribeResponse(merged);

    const values = quads.map((q) => q.object.value).sort();
    expect(values).toEqual(['http://example.org/a', 'http://example.org/c']);
    expect(merged.total).toBe(2);

    // alpha still owns aQuad; beta now owns cQuad; bQuad has been dropped.
    for (const q of quads) {
      const key = `NamedNode:${q.subject.value} NamedNode:${q.predicate.value} NamedNode:${q.object.value} DefaultGraph:`;
      const origins = originsByQuad.get(key) ?? [];
      if (q.object.value === 'http://example.org/a') expect(origins).toEqual(['alpha']);
      if (q.object.value === 'http://example.org/c') expect(origins).toEqual(['beta']);
    }
  });

  it('dedupes a quad asserted by both the named source and a peer into a single quad with multi-origin attribution', () => {
    const shared = quad(namedNode(SEED), namedNode(P), namedNode('http://example.org/x'));
    const current = buildResponse([
      ['alpha', [shared]],
      ['beta', [shared]],
    ]);
    // beta re-runs and still has the shared quad.
    const fresh = buildResponse([['beta', [shared]]]);

    const merged = mergeDescribeSourceSlice(current, 'beta', fresh);
    const { quads, originsByQuad } = stripDescribeResponse(merged);

    expect(quads.length).toBe(1);
    expect(merged.total).toBe(1);
    const key = `NamedNode:${SEED} NamedNode:${P} NamedNode:http://example.org/x DefaultGraph:`;
    expect([...(originsByQuad.get(key) ?? [])].sort()).toEqual(['alpha', 'beta']);
  });

  it('admits a brand-new source on first expand: contributes its slice alongside the peer', () => {
    const aQuad = quad(namedNode(SEED), namedNode(P), namedNode('http://example.org/a'));
    const dQuad = quad(namedNode(SEED), namedNode(P), namedNode('http://example.org/d'));
    const current = buildResponse([['alpha', [aQuad]]]);
    const fresh = buildResponse([['delta', [dQuad]]]);

    const merged = mergeDescribeSourceSlice(current, 'delta', fresh);
    const { quads } = stripDescribeResponse(merged);

    expect(quads.map((q) => q.object.value).sort()).toEqual([
      'http://example.org/a',
      'http://example.org/d',
    ]);
    expect(merged.total).toBe(2);
  });

  it('preserves the response iri from current (the URL-bound seed is the source of truth)', () => {
    const q = quad(namedNode(SEED), namedNode(P), namedNode('http://example.org/a'));
    const current = buildResponse([['alpha', [q]]]);
    const fresh: DescribeResponse = { ...buildResponse([['alpha', [q]]]), iri: 'http://wrong/iri' };
    const merged = mergeDescribeSourceSlice(current, 'alpha', fresh);
    expect(merged.iri).toBe(SEED);
  });

  it('handles an empty-slice fresh response by dropping the named source slice (and admits no annotations for it)', () => {
    const aQuad = quad(namedNode(SEED), namedNode(P), namedNode('http://example.org/a'));
    const bQuad = quad(namedNode(SEED), namedNode(P), namedNode('http://example.org/b'));
    const current = buildResponse([
      ['alpha', [aQuad]],
      ['beta', [bQuad]],
    ]);
    const fresh: DescribeResponse = {
      iri: SEED,
      quads: '',
      total: 0,
      truncated: false,
    };
    const merged = mergeDescribeSourceSlice(current, 'beta', fresh);
    const { quads, originsByQuad } = stripDescribeResponse(merged);
    expect(quads.map((q) => q.object.value)).toEqual(['http://example.org/a']);
    const key = `NamedNode:${SEED} NamedNode:${P} NamedNode:http://example.org/a DefaultGraph:`;
    expect(originsByQuad.get(key)).toEqual(['alpha']);
  });
});
