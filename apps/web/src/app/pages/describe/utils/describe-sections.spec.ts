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

  describe('RDF-star annotations (PRD #221, slice #225)', () => {
    it('populates annotations on a member when its quad has one RDF-star annotation attached', () => {
      const knows = namedNode('http://example.org/knows');
      const bob = namedNode('http://example.org/bob');
      const annotated = quad(seed, knows, bob);
      // RDF-star annotation: the asserted quad above is the subject of an
      // annotation quad. The describe wire carries both side by side; the
      // builder must group annotations by their inner-quad subject.
      const annotation = quad(
        // n3.js typings omit RDF-star quoted triples in subject position; the
        // runtime accepts a Quad and emits termType 'Quad' (see strip-annotations).
        annotated as unknown as Quad['subject'],
        namedNode('http://example.org/sourcedBy'),
        namedNode('http://example.org/CensusBureau'),
      );
      const { outbound } = buildDescribeSections(
        [annotated, annotation],
        NO_ORIGINS,
        SEED,
        NO_ENDPOINTS,
      );
      const member = outbound.predicateGroups[0].members[0];
      expect(member.term.value).toBe('http://example.org/bob');
      expect(member.annotations.length).toBe(1);
      const block = member.annotations[0];
      expect(block.kind).toBe('annotation');
      expect(block.predicateGroups.length).toBe(1);
      expect(block.predicateGroups[0].predicate).toBe('http://example.org/sourcedBy');
      expect(block.predicateGroups[0].members.length).toBe(1);
      expect(block.predicateGroups[0].members[0].term).toEqual(
        expect.objectContaining({
          termType: 'NamedNode',
          value: 'http://example.org/CensusBureau',
        }),
      );
    });

    it('groups multiple annotation quads on the same triple into one block; predicates alphabetical, members ordered IRIs → literals → bnodes', () => {
      const annotated = quad(
        seed,
        namedNode('http://example.org/knows'),
        namedNode('http://example.org/bob'),
      );
      const innerSubject = annotated as unknown as Quad['subject'];
      const sourcedBy = namedNode('http://example.org/sourcedBy');
      const annotations = [
        // :year — sorts after :sourcedBy alphabetically.
        quad(innerSubject, namedNode('http://example.org/year'), literal('2023')),
        // :sourcedBy with three values: a bnode, a literal, two IRIs.
        quad(innerSubject, sourcedBy, blankNode('annB')),
        quad(innerSubject, sourcedBy, literal('hearsay')),
        quad(innerSubject, sourcedBy, namedNode('http://example.org/CensusBureau')),
        quad(innerSubject, sourcedBy, namedNode('http://example.org/Acme')),
      ];
      const { outbound } = buildDescribeSections(
        [annotated, ...annotations],
        NO_ORIGINS,
        SEED,
        NO_ENDPOINTS,
      );
      const member = outbound.predicateGroups[0].members[0];
      expect(member.annotations.length).toBe(1);
      const block = member.annotations[0];
      // Predicate groups are alphabetical.
      expect(block.predicateGroups.map((g) => g.predicate)).toEqual([
        'http://example.org/sourcedBy',
        'http://example.org/year',
      ]);
      // Within :sourcedBy: IRIs (alphabetical) → literals → bnodes.
      const sourcedByGroup = block.predicateGroups[0];
      expect(
        sourcedByGroup.members.map((m) => `${m.term.termType}:${m.term.value}`),
      ).toEqual([
        'NamedNode:http://example.org/Acme',
        'NamedNode:http://example.org/CensusBureau',
        'Literal:hearsay',
        'BlankNode:annB',
      ]);
    });

    it('inlines a single-use bnode object inside an annotation as a nested BnodeBlock', () => {
      const annotated = quad(
        seed,
        namedNode('http://example.org/knows'),
        namedNode('http://example.org/bob'),
      );
      const provenance = blankNode('prov');
      const quads = [
        annotated,
        quad(
          annotated as unknown as Quad['subject'],
          namedNode('http://example.org/provenance'),
          provenance,
        ),
        quad(provenance, namedNode('http://example.org/agent'), namedNode('http://example.org/Acme')),
        quad(provenance, namedNode('http://example.org/when'), literal('2023')),
      ];
      const { outbound } = buildDescribeSections(quads, NO_ORIGINS, SEED, NO_ENDPOINTS);
      const member = outbound.predicateGroups[0].members[0];
      const ann = member.annotations[0];
      expect(ann.predicateGroups.length).toBe(1);
      const provMember = ann.predicateGroups[0].members[0];
      const nested = provMember.nested;
      if (!nested || nested.kind !== 'bnode') throw new Error('expected nested bnode in annotation');
      expect(nested.label).toBeNull();
      expect(nested.predicateGroups.map((g) => g.predicate)).toEqual([
        'http://example.org/agent',
        'http://example.org/when',
      ]);
    });

    it('populates annotations on an inbound member when an inbound quad carries an RDF-star annotation', () => {
      const inboundQuad = quad(
        namedNode('http://example.org/carol'),
        namedNode('http://example.org/knows'),
        seed,
      );
      const annotation = quad(
        inboundQuad as unknown as Quad['subject'],
        namedNode('http://example.org/sourcedBy'),
        namedNode('http://example.org/CensusBureau'),
      );
      const { outbound, inbound } = buildDescribeSections(
        [inboundQuad, annotation],
        NO_ORIGINS,
        SEED,
        NO_ENDPOINTS,
      );
      expect(outbound.predicateGroups.length).toBe(0);
      expect(inbound.predicateGroups.length).toBe(1);
      const member = inbound.predicateGroups[0].members[0];
      expect(member.term.value).toBe('http://example.org/carol');
      expect(member.annotations.length).toBe(1);
      const block = member.annotations[0];
      expect(block.predicateGroups[0].predicate).toBe('http://example.org/sourcedBy');
      expect(block.predicateGroups[0].members[0].term.value).toBe(
        'http://example.org/CensusBureau',
      );
    });
  });

  describe('blank-node nesting (PRD #221, slice #223)', () => {
    it('populates a single-use bnode object with an empty inline BnodeBlock (no label)', () => {
      const b = blankNode('b0');
      const q = quad(seed, namedNode('http://example.org/address'), b);
      const { outbound } = buildDescribeSections([q], NO_ORIGINS, SEED, NO_ENDPOINTS);
      const member = outbound.predicateGroups[0].members[0];
      expect(member.nested).toEqual({
        kind: 'bnode',
        label: null,
        predicateGroups: [],
      });
    });

    it('lifts a bnode object’s outgoing quads into its inline BnodeBlock predicate groups', () => {
      const b = blankNode('b0');
      const quads = [
        quad(seed, namedNode('http://example.org/address'), b),
        quad(b, namedNode('http://example.org/city'), literal('Paris')),
        quad(b, namedNode('http://example.org/zip'), literal('75001')),
      ];
      const { outbound } = buildDescribeSections(quads, NO_ORIGINS, SEED, NO_ENDPOINTS);
      const member = outbound.predicateGroups[0].members[0];
      const nested = member.nested;
      if (!nested || nested.kind !== 'bnode') throw new Error('expected bnode nested');
      expect(nested.label).toBeNull();
      expect(nested.predicateGroups.map((g) => g.predicate)).toEqual([
        'http://example.org/city',
        'http://example.org/zip',
      ]);
      expect(nested.predicateGroups[0].members.map((m) => m.term.value)).toEqual([
        'Paris',
      ]);
      // The seed section should NOT carry the bnode's outgoing quads as
      // top-level groups — they've moved into the nested subtree.
      expect(outbound.predicateGroups.length).toBe(1);
      expect(outbound.predicateGroups[0].predicate).toBe('http://example.org/address');
    });

    it('duplicates a both-ways bnode into outbound AND inbound with its subtree in each', () => {
      const b = blankNode('shared');
      const quads = [
        quad(seed, namedNode('http://example.org/has'), b),
        quad(b, namedNode('http://example.org/p'), seed),
        quad(b, namedNode('http://example.org/note'), literal('hi')),
      ];
      const { outbound, inbound } = buildDescribeSections(
        quads,
        NO_ORIGINS,
        SEED,
        NO_ENDPOINTS,
      );
      // Outbound: seed→:has→b, with b's subtree.
      expect(outbound.predicateGroups.length).toBe(1);
      const outBlock = outbound.predicateGroups[0].members[0].nested;
      if (!outBlock || outBlock.kind !== 'bnode') throw new Error('outbound bnode');
      expect(outBlock.predicateGroups.map((g) => g.predicate)).toEqual([
        'http://example.org/note',
        'http://example.org/p',
      ]);
      // Inbound: b→:p→seed, with b's subtree (same content).
      expect(inbound.predicateGroups.length).toBe(1);
      const inBlock = inbound.predicateGroups[0].members[0].nested;
      if (!inBlock || inBlock.kind !== 'bnode') throw new Error('inbound bnode');
      expect(inBlock.predicateGroups.map((g) => g.predicate)).toEqual([
        'http://example.org/note',
        'http://example.org/p',
      ]);
    });

    it('falls back to a plain BnodeBlock when a chain is missing rdf:rest', () => {
      const RDF_FIRST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
      const head = blankNode('h0');
      const quads = [
        quad(seed, namedNode('http://example.org/items'), head),
        // rdf:first is present, but no rdf:rest → not a valid list.
        quad(head, namedNode(RDF_FIRST), namedNode('http://example.org/a')),
      ];
      const { outbound } = buildDescribeSections(quads, NO_ORIGINS, SEED, NO_ENDPOINTS);
      const block = outbound.predicateGroups[0].members[0].nested;
      if (!block || block.kind !== 'bnode') {
        throw new Error('expected fallback bnode block, got ' + block?.kind);
      }
      expect(block.predicateGroups.map((g) => g.predicate)).toEqual([RDF_FIRST]);
    });

    it('collapses an rdf:first/rdf:rest/rdf:nil chain into a CollectionBlock', () => {
      const RDF_FIRST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
      const RDF_REST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest';
      const RDF_NIL = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil';
      const head = blankNode('h0');
      const mid = blankNode('h1');
      const quads = [
        quad(seed, namedNode('http://example.org/items'), head),
        quad(head, namedNode(RDF_FIRST), namedNode('http://example.org/a')),
        quad(head, namedNode(RDF_REST), mid),
        quad(mid, namedNode(RDF_FIRST), literal('b')),
        quad(mid, namedNode(RDF_REST), namedNode(RDF_NIL)),
      ];
      const { outbound } = buildDescribeSections(quads, NO_ORIGINS, SEED, NO_ENDPOINTS);
      const block = outbound.predicateGroups[0].members[0].nested;
      if (!block || block.kind !== 'collection') {
        throw new Error('expected collection block');
      }
      expect(block.items.length).toBe(2);
      expect(block.items[0].term).toEqual(
        expect.objectContaining({ termType: 'NamedNode', value: 'http://example.org/a' }),
      );
      expect(block.items[1].term).toEqual(
        expect.objectContaining({ termType: 'Literal', value: 'b' }),
      );
    });

    it('terminates a bnode cycle with a labeled back-reference (no infinite recursion)', () => {
      const a = blankNode('A');
      const b = blankNode('B');
      const quads = [
        quad(seed, namedNode('http://example.org/has'), a),
        quad(a, namedNode('http://example.org/next'), b),
        quad(b, namedNode('http://example.org/back'), a),
      ];
      const { outbound } = buildDescribeSections(quads, NO_ORIGINS, SEED, NO_ENDPOINTS);
      const aBlock = outbound.predicateGroups[0].members[0].nested;
      if (!aBlock || aBlock.kind !== 'bnode') throw new Error('expected A bnode');
      const bBlock = aBlock.predicateGroups[0].members[0].nested;
      if (!bBlock || bBlock.kind !== 'bnode') throw new Error('expected B bnode');
      const aBackRef = bBlock.predicateGroups[0].members[0].nested;
      if (!aBackRef || aBackRef.kind !== 'bnode') throw new Error('expected A back-ref');
      expect(aBackRef.label).toBe(aBlock.label);
      expect(aBlock.label).not.toBeNull();
      // The back-ref carries no further content — that's what stopped the cycle.
      expect(aBackRef.predicateGroups).toEqual([]);
    });

    it('labels a multi-reference bnode and emits its subtree at the first site only', () => {
      const b = blankNode('shared');
      const quads = [
        // Two outbound seed predicates both point at the same bnode.
        quad(seed, namedNode('http://example.org/home'), b),
        quad(seed, namedNode('http://example.org/work'), b),
        quad(b, namedNode('http://example.org/city'), literal('Paris')),
      ];
      const { outbound } = buildDescribeSections(quads, NO_ORIGINS, SEED, NO_ENDPOINTS);
      // Predicates are alphabetical: :home before :work.
      const homeBlock = outbound.predicateGroups[0].members[0].nested;
      const workBlock = outbound.predicateGroups[1].members[0].nested;
      if (!homeBlock || homeBlock.kind !== 'bnode') throw new Error('home bnode');
      if (!workBlock || workBlock.kind !== 'bnode') throw new Error('work bnode');
      // Both sites carry the same label (multi-ref).
      expect(homeBlock.label).not.toBeNull();
      expect(workBlock.label).toBe(homeBlock.label);
      // Canonical content lands at the first site only; the second is a back-ref.
      expect(homeBlock.predicateGroups.length).toBe(1);
      expect(homeBlock.predicateGroups[0].predicate).toBe('http://example.org/city');
      expect(workBlock.predicateGroups).toEqual([]);
    });

    it('leaves expand null when the bnode origin is not in the endpoint set', () => {
      const b = blankNode('local__b0');
      const q = quad(seed, namedNode('http://example.org/knows'), b);
      const { outbound } = buildDescribeSections(
        [q],
        NO_ORIGINS,
        SEED,
        new Set(['remote']),
      );
      expect(outbound.predicateGroups[0].members[0].expand).toBeNull();
    });

    it('leaves expand null on a dangling bnode past the path-step cap (13 hops)', () => {
      // Chain: seed -p-> b1 -p-> b2 -> … -> b13 (dangling). Cap is 12, so b13
      // — reached in 13 predicate hops — must NOT carry an expand target.
      const p = namedNode('http://example.org/p');
      const quads = [quad(seed, p, blankNode('remote__b1'))];
      for (let i = 1; i < 13; i++) {
        quads.push(quad(blankNode(`remote__b${i}`), p, blankNode(`remote__b${i + 1}`)));
      }
      const { outbound } = buildDescribeSections(
        quads,
        NO_ORIGINS,
        SEED,
        new Set(['remote']),
      );
      // Walk down 12 nested levels: top member is b1, then b2..b13.
      let member = outbound.predicateGroups[0].members[0];
      for (let i = 1; i < 13; i++) {
        const block = member.nested;
        if (!block || block.kind !== 'bnode') throw new Error('expected bnode at hop ' + i);
        member = block.predicateGroups[0].members[0];
      }
      expect(member.term.value).toBe('remote__b13');
      expect(member.expand).toBeNull();
    });

    it('leaves expand null on a fully-resolved bnode (the bnode is in subject position)', () => {
      const b = blankNode('remote__b0');
      const quads = [
        quad(seed, namedNode('http://example.org/address'), b),
        quad(b, namedNode('http://example.org/city'), literal('Paris')),
      ];
      const { outbound } = buildDescribeSections(
        quads,
        NO_ORIGINS,
        SEED,
        new Set(['remote']),
      );
      const member = outbound.predicateGroups[0].members[0];
      expect(member.expand).toBeNull();
    });

    it('pins an expand target on a dangling endpoint-origin bnode within the cap', () => {
      const b = blankNode('remote__b0');
      const q = quad(seed, namedNode('http://example.org/knows'), b);
      const { outbound } = buildDescribeSections(
        [q],
        NO_ORIGINS,
        SEED,
        new Set(['remote']),
      );
      const member = outbound.predicateGroups[0].members[0];
      expect(member.expand).toEqual({
        sourceId: 'remote',
        path: [{ predicate: 'http://example.org/knows', inverse: false }],
      });
    });

    it('recurses through nested bnodes (address → geo → lat/long)', () => {
      const address = blankNode('addr');
      const geo = blankNode('geo');
      const quads = [
        quad(seed, namedNode('http://example.org/address'), address),
        quad(address, namedNode('http://example.org/geo'), geo),
        quad(geo, namedNode('http://example.org/lat'), literal('48.85')),
        quad(geo, namedNode('http://example.org/long'), literal('2.35')),
      ];
      const { outbound } = buildDescribeSections(quads, NO_ORIGINS, SEED, NO_ENDPOINTS);
      const addrBlock = outbound.predicateGroups[0].members[0].nested;
      if (!addrBlock || addrBlock.kind !== 'bnode') throw new Error('expected addr bnode');
      const geoBlock = addrBlock.predicateGroups[0].members[0].nested;
      if (!geoBlock || geoBlock.kind !== 'bnode') throw new Error('expected geo bnode');
      expect(geoBlock.predicateGroups.map((g) => g.predicate)).toEqual([
        'http://example.org/lat',
        'http://example.org/long',
      ]);
    });
  });
});
