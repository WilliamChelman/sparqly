import { DataFactory, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import { relabelBnodes } from './relabel-bnodes';
import { ttl } from '../test/turtle';

const { namedNode, literal, quad, blankNode, defaultGraph } = DataFactory;

describe('relabelBnodes', () => {
  it('rewrites every bnode label by prefixing the given prefix and a separator', () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:has _:b1 .
      _:b1 ex:label "first" .
    `;

    const out = relabelBnodes(quads, 'foo');

    const bnodes = new Set<string>();
    for (const q of out) {
      if (q.subject.termType === 'BlankNode') bnodes.add(q.subject.value);
      if (q.object.termType === 'BlankNode') bnodes.add(q.object.value);
    }
    expect(bnodes.size).toBe(1);
    const [only] = [...bnodes];
    expect(only.startsWith('foo__')).toBe(true);
  });

  it('preserves all non-bnode terms verbatim (named nodes, literals, graphs)', () => {
    const q = quad(
      namedNode('http://example.org/alice'),
      namedNode('http://example.org/p'),
      literal('hello'),
      namedNode('http://example.org/g'),
    );

    const [out] = relabelBnodes([q], 'src');
    expect(out.subject.equals(q.subject)).toBe(true);
    expect(out.predicate.equals(q.predicate)).toBe(true);
    expect(out.object.equals(q.object)).toBe(true);
    expect(out.graph.equals(q.graph)).toBe(true);
  });

  it('maps the same bnode label consistently across multiple quads (preserves co-reference)', () => {
    const b = blankNode('shared');
    const q1 = quad(b, namedNode('http://example.org/a'), literal('1'), defaultGraph());
    const q2 = quad(b, namedNode('http://example.org/b'), literal('2'), defaultGraph());

    const [r1, r2] = relabelBnodes([q1, q2], 'src');
    expect(r1.subject.termType).toBe('BlankNode');
    expect(r2.subject.termType).toBe('BlankNode');
    expect(r1.subject.value).toBe(r2.subject.value);
  });

  it('produces disjoint label spaces for different prefixes (same label, different prefix => different bnodes)', () => {
    const s = new Store();
    const b = blankNode('b1');
    s.addQuad(quad(namedNode('http://example.org/a'), namedNode('http://example.org/p'), b, defaultGraph()));
    const [aPrefixed] = relabelBnodes([...s], 'A');
    const [bPrefixed] = relabelBnodes([...s], 'B');
    expect(aPrefixed.object.termType).toBe('BlankNode');
    expect(bPrefixed.object.termType).toBe('BlankNode');
    expect(aPrefixed.object.value).not.toBe(bPrefixed.object.value);
  });

  it('rewrites bnodes inside RDF-star quoted-triple subjects (quoted-triple is recursive)', () => {
    const innerBnode = blankNode('inner');
    const inner = quad(
      innerBnode,
      namedNode('http://example.org/p'),
      literal('x'),
    );
    const outer = quad(
      inner,
      namedNode('http://example.org/source'),
      literal('wiki'),
    );

    const [out] = relabelBnodes([outer], 'src');
    expect((out.subject.termType as string)).toBe('Quad');
    const reified = out.subject as unknown as import('n3').Quad;
    expect(reified.subject.termType).toBe('BlankNode');
    expect(reified.subject.value.startsWith('src__')).toBe(true);
  });

  it('sanitizes prefix characters that are invalid in N-Triples bnode labels (e.g., "/")', () => {
    // Source ids like `data/era-ontology.ttl` (split-glob children) contain
    // `/`, which is not part of PN_CHARS — using such an id verbatim as a
    // bnode-label prefix produces labels that cannot round-trip through
    // N-Triples serialization (the wire format used by the describe API).
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:has _:b1 .
    `;

    const [out] = relabelBnodes(quads, 'data/era-ontology.ttl');
    expect(out.object.termType).toBe('BlankNode');
    // PN_CHARS-safe: letters, digits, underscore, hyphen, dot.
    expect(out.object.value).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it('is deterministic: same input + same prefix => same labels each call', () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      _:b1 ex:p _:b2 .
      _:b2 ex:q _:b1 .
    `;

    const a = relabelBnodes(quads, 'src');
    const b = relabelBnodes(quads, 'src');
    const aLabels = a.map((q) => `${q.subject.value}|${q.object.value}`);
    const bLabels = b.map((q) => `${q.subject.value}|${q.object.value}`);
    expect(aLabels).toEqual(bLabels);
  });
});
