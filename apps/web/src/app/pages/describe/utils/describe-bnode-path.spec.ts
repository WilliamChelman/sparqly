import { describe, expect, it } from 'vitest';
import { DataFactory } from 'n3';
import {
  describeBnodePath,
  isExpandableBnode,
  recoverSourceId,
} from './describe-bnode-path';

const { namedNode, blankNode, literal, quad } = DataFactory;

const SEED = 'http://example.org/alice';
const seed = namedNode(SEED);

describe('recoverSourceId', () => {
  it('recovers the source id from a rewritten bnode label', () => {
    expect(recoverSourceId('alpha__b0')).toBe('alpha');
  });

  it('splits on the first separator only', () => {
    expect(recoverSourceId('alpha__b__0')).toBe('alpha');
  });

  it('returns null for a label with no rewrite prefix', () => {
    expect(recoverSourceId('b0')).toBeNull();
  });
});

describe('describeBnodePath', () => {
  it('finds a one-hop path from the seed to a dangling bnode', () => {
    const quads = [quad(seed, namedNode('http://example.org/knows'), blankNode('alpha__b0'))];
    expect(describeBnodePath(quads, 'alpha__b0', SEED)).toEqual({
      sourceId: 'alpha',
      path: [{ predicate: 'http://example.org/knows', inverse: false }],
    });
  });

  it('follows a multi-hop blank-node chain from the seed', () => {
    const quads = [
      quad(seed, namedNode('http://example.org/p1'), blankNode('alpha__b0')),
      quad(blankNode('alpha__b0'), namedNode('http://example.org/p2'), blankNode('alpha__b1')),
    ];
    expect(describeBnodePath(quads, 'alpha__b1', SEED)).toEqual({
      sourceId: 'alpha',
      path: [
        { predicate: 'http://example.org/p1', inverse: false },
        { predicate: 'http://example.org/p2', inverse: false },
      ],
    });
  });

  it('records an inverse step when an edge points back towards the prior node', () => {
    const quads = [
      quad(seed, namedNode('http://example.org/p1'), blankNode('alpha__b1')),
      quad(blankNode('alpha__b0'), namedNode('http://example.org/p2'), blankNode('alpha__b1')),
    ];
    expect(describeBnodePath(quads, 'alpha__b0', SEED)).toEqual({
      sourceId: 'alpha',
      path: [
        { predicate: 'http://example.org/p1', inverse: false },
        { predicate: 'http://example.org/p2', inverse: true },
      ],
    });
  });

  it('records an inverse first step when the seed is the object of the edge', () => {
    const quads = [quad(blankNode('alpha__b0'), namedNode('http://example.org/p'), seed)];
    expect(describeBnodePath(quads, 'alpha__b0', SEED)).toEqual({
      sourceId: 'alpha',
      path: [{ predicate: 'http://example.org/p', inverse: true }],
    });
  });

  it('returns null when no blank-node path connects the seed to the target', () => {
    const quads = [
      quad(namedNode('http://example.org/carol'), namedNode('http://example.org/p'), blankNode('alpha__b0')),
    ];
    expect(describeBnodePath(quads, 'alpha__b0', SEED)).toBeNull();
  });

  it('returns null when the label carries no source-id prefix', () => {
    const quads = [quad(seed, namedNode('http://example.org/p'), blankNode('b0'))];
    expect(describeBnodePath(quads, 'b0', SEED)).toBeNull();
  });
});

describe('isExpandableBnode', () => {
  const endpoints = new Set(['alpha']);

  it('is true for a dangling bnode whose source is an endpoint', () => {
    const quads = [quad(seed, namedNode('http://example.org/p'), blankNode('alpha__b0'))];
    expect(isExpandableBnode(quads, 'alpha__b0', endpoints)).toBe(true);
  });

  it('is false when the bnode also appears in subject position (already expanded)', () => {
    const quads = [
      quad(seed, namedNode('http://example.org/p'), blankNode('alpha__b0')),
      quad(blankNode('alpha__b0'), namedNode('http://example.org/q'), literal('x')),
    ];
    expect(isExpandableBnode(quads, 'alpha__b0', endpoints)).toBe(false);
  });

  it('is false for a bnode from a non-endpoint source', () => {
    const quads = [quad(seed, namedNode('http://example.org/p'), blankNode('beta__b0'))];
    expect(isExpandableBnode(quads, 'beta__b0', endpoints)).toBe(false);
  });

  it('is false when the label carries no source-id prefix', () => {
    const quads = [quad(seed, namedNode('http://example.org/p'), blankNode('b0'))];
    expect(isExpandableBnode(quads, 'b0', endpoints)).toBe(false);
  });

  it('is false when the bnode does not appear in the quad set at all', () => {
    const quads = [quad(seed, namedNode('http://example.org/p'), blankNode('alpha__b0'))];
    expect(isExpandableBnode(quads, 'alpha__b9', endpoints)).toBe(false);
  });
});
