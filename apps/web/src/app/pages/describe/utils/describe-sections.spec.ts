import { describe, expect, it } from 'vitest';
import { DataFactory, type Quad, type Term } from 'n3';
import { buildDescribeSections } from './describe-sections';

const { namedNode, blankNode, literal, quad } = DataFactory;

// Mirrors `describeProvenance.strip`'s key format so test fixtures can be
// indexed the same way the page indexes its `originsByQuad` map.
function quadKey(q: Quad): string {
  return `${termKey(q.subject)} ${termKey(q.predicate)} ${termKey(q.object)} ${termKey(q.graph)}`;
}
function termKey(t: Term): string {
  return `${t.termType}:${t.value}`;
}

const SEED = 'http://example.org/alice';
const seed = namedNode(SEED);
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

const NO_ORIGINS = new Map<string, readonly string[]>();
const NO_ENDPOINTS = new Set<string>();

describe('buildDescribeSections', () => {
  it('places a seed→p→o quad in outbound with one predicate group and one member', () => {
    const q = quad(seed, namedNode('http://example.org/knows'), namedNode('http://example.org/bob'));
    const { outbound, inbound } = buildDescribeSections([q], NO_ORIGINS, SEED, NO_ENDPOINTS);

    expect(outbound.direction).toBe('outbound');
    expect(inbound.direction).toBe('inbound');
    expect(outbound.predicateGroups.length).toBe(1);
    expect(outbound.predicateGroups[0].predicate).toBe('http://example.org/knows');
    expect(outbound.predicateGroups[0].members.length).toBe(1);
    expect(outbound.predicateGroups[0].members[0].term).toEqual(
      expect.objectContaining({ termType: 'NamedNode', value: 'http://example.org/bob' }),
    );
    expect(inbound.predicateGroups.length).toBe(0);
  });

  it('places a quad with the seed as object in inbound; the member term is the subject', () => {
    const q = quad(namedNode('http://example.org/carol'), namedNode('http://example.org/knows'), seed);
    const { outbound, inbound } = buildDescribeSections([q], NO_ORIGINS, SEED, NO_ENDPOINTS);

    expect(outbound.predicateGroups.length).toBe(0);
    expect(inbound.predicateGroups.length).toBe(1);
    expect(inbound.predicateGroups[0].predicate).toBe('http://example.org/knows');
    expect(inbound.predicateGroups[0].members.length).toBe(1);
    expect(inbound.predicateGroups[0].members[0].term).toEqual(
      expect.objectContaining({ termType: 'NamedNode', value: 'http://example.org/carol' }),
    );
  });

  it('collapses repeated predicates into one group with multiple members', () => {
    const knows = namedNode('http://example.org/knows');
    const quads = [
      quad(seed, knows, namedNode('http://example.org/bob')),
      quad(seed, knows, namedNode('http://example.org/carol')),
      quad(seed, namedNode('http://example.org/age'), literal('30')),
    ];
    const { outbound } = buildDescribeSections(quads, NO_ORIGINS, SEED, NO_ENDPOINTS);
    const knowsGroup = outbound.predicateGroups.find((g) => g.predicate === 'http://example.org/knows');
    expect(knowsGroup?.members.map((m) => m.term.value)).toEqual([
      'http://example.org/bob',
      'http://example.org/carol',
    ]);
    expect(outbound.predicateGroups.length).toBe(2);
  });

  it('orders outbound predicate groups: rdf:type first, then alphabetical by IRI', () => {
    const quads = [
      quad(seed, namedNode('http://example.org/zebra'), namedNode('http://example.org/z')),
      quad(seed, namedNode('http://example.org/age'), literal('30')),
      quad(seed, namedNode(RDF_TYPE), namedNode('http://example.org/Person')),
    ];
    const { outbound } = buildDescribeSections(quads, NO_ORIGINS, SEED, NO_ENDPOINTS);
    expect(outbound.predicateGroups.map((g) => g.predicate)).toEqual([
      RDF_TYPE,
      'http://example.org/age',
      'http://example.org/zebra',
    ]);
  });

  it('orders inbound predicate groups alphabetically (rdf:type is not pinned first inbound)', () => {
    // rdf:type's IRI starts with `http://www.w3.org/...`, which sorts after
    // `http://example.org/...` — proving the outbound `rdf:type`-first pin
    // is *not* applied inbound.
    const quads = [
      quad(namedNode('http://example.org/x'), namedNode('http://example.org/zebra'), seed),
      quad(namedNode('http://example.org/y'), namedNode(RDF_TYPE), seed),
      quad(namedNode('http://example.org/z'), namedNode('http://example.org/age'), seed),
    ];
    const { inbound } = buildDescribeSections(quads, NO_ORIGINS, SEED, NO_ENDPOINTS);
    expect(inbound.predicateGroups.map((g) => g.predicate)).toEqual([
      'http://example.org/age',
      'http://example.org/zebra',
      RDF_TYPE,
    ]);
  });

  it('orders members within a group: named IRIs alphabetical → literals lexical → blank nodes last', () => {
    const p = namedNode('http://example.org/p');
    const quads = [
      quad(seed, p, blankNode('b0')),
      quad(seed, p, literal('beta')),
      quad(seed, p, namedNode('http://example.org/charlie')),
      quad(seed, p, namedNode('http://example.org/alice')),
      quad(seed, p, literal('alpha')),
    ];
    const { outbound } = buildDescribeSections(quads, NO_ORIGINS, SEED, NO_ENDPOINTS);
    const members = outbound.predicateGroups[0].members;
    expect(members.map((m) => `${m.term.termType}:${m.term.value}`)).toEqual([
      'NamedNode:http://example.org/alice',
      'NamedNode:http://example.org/charlie',
      'Literal:alpha',
      'Literal:beta',
      'BlankNode:b0',
    ]);
  });

  it('carries origins through to each member, keyed by quad', () => {
    const q1 = quad(seed, namedNode('http://example.org/p'), namedNode('http://example.org/alice'));
    const q2 = quad(seed, namedNode('http://example.org/p'), namedNode('http://example.org/bob'));
    const origins = new Map<string, readonly string[]>([
      [quadKey(q1), ['alpha']],
      [quadKey(q2), ['alpha', 'beta']],
    ]);
    const { outbound } = buildDescribeSections([q1, q2], origins, SEED, NO_ENDPOINTS);
    const members = outbound.predicateGroups[0].members;
    expect(members.map((m) => ({ v: m.term.value, o: m.origins }))).toEqual([
      { v: 'http://example.org/alice', o: ['alpha'] },
      { v: 'http://example.org/bob', o: ['alpha', 'beta'] },
    ]);
  });

  it('carries the named graph onto each member; default graph maps to null', () => {
    const g1 = namedNode('http://example.org/g1');
    const q1 = quad(seed, namedNode('http://example.org/p'), namedNode('http://example.org/alice'), g1);
    const q2 = quad(seed, namedNode('http://example.org/p'), namedNode('http://example.org/bob'));
    const { outbound } = buildDescribeSections([q1, q2], NO_ORIGINS, SEED, NO_ENDPOINTS);
    const members = outbound.predicateGroups[0].members;
    const byValue = new Map(members.map((m) => [m.term.value, m] as const));
    expect(byValue.get('http://example.org/alice')?.graph).toEqual(
      expect.objectContaining({ termType: 'NamedNode', value: 'http://example.org/g1' }),
    );
    expect(byValue.get('http://example.org/bob')?.graph).toBeNull();
  });

  it('reports per-section quad counts on each Section', () => {
    const p = namedNode('http://example.org/p');
    const q = namedNode('http://example.org/q');
    const quads = [
      quad(seed, p, namedNode('http://example.org/a')),
      quad(seed, p, namedNode('http://example.org/b')),
      quad(seed, q, namedNode('http://example.org/c')),
      quad(namedNode('http://example.org/x'), p, seed),
    ];
    const { outbound, inbound } = buildDescribeSections(quads, NO_ORIGINS, SEED, NO_ENDPOINTS);
    expect(outbound.count).toBe(3);
    expect(inbound.count).toBe(1);
  });

  it('places a self-loop (<seed> :p <seed>) once, under outbound', () => {
    const q = quad(seed, namedNode('http://example.org/knows'), seed);
    const { outbound, inbound } = buildDescribeSections([q], NO_ORIGINS, SEED, NO_ENDPOINTS);
    expect(outbound.count).toBe(1);
    expect(outbound.predicateGroups[0].members.length).toBe(1);
    expect(inbound.count).toBe(0);
    expect(inbound.predicateGroups.length).toBe(0);
  });
});
