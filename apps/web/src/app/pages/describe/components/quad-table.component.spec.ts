import { TestBed } from '@angular/core/testing';
import { DataFactory } from 'n3';
import { describeProvenance, serializeDescribeWire } from 'common';
import type { DisplayContext } from '@app/core';
import { QuadTableComponent } from './quad-table.component';

const { namedNode, blankNode, literal, quad } = DataFactory;

const FROM_SOURCE = 'urn:sparqly:fromSource';

function setup(
  quadsText: string,
  seed = '',
  context?: DisplayContext,
  endpointSourceIds?: readonly string[],
) {
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(QuadTableComponent);
  fixture.componentRef.setInput('quadsText', quadsText);
  fixture.componentRef.setInput('seed', seed);
  if (context !== undefined) fixture.componentRef.setInput('context', context);
  if (endpointSourceIds !== undefined)
    fixture.componentRef.setInput('endpointSourceIds', endpointSourceIds);
  fixture.detectChanges();
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

describe('QuadTableComponent', () => {
  it('renders a "from" column header', () => {
    const q = quad(
      namedNode('http://example.org/alice'),
      namedNode('http://example.org/knows'),
      namedNode('http://example.org/bob'),
    );
    const wire = serializeDescribeWire(describeProvenance.inject([q], 'alpha', FROM_SOURCE));
    const { root } = setup(wire, 'http://example.org/alice');
    const headers = Array.from(root.querySelectorAll('thead th')).map((th) => th.textContent?.trim());
    expect(headers).toContain('from');
  });

  it('strips provenance annotations from the visible body rows', () => {
    const q = quad(
      namedNode('http://example.org/alice'),
      namedNode('http://example.org/knows'),
      namedNode('http://example.org/bob'),
    );
    const wire = serializeDescribeWire(describeProvenance.inject([q], 'alpha', FROM_SOURCE));
    const { root } = setup(wire, 'http://example.org/alice');
    // Only one quad survives, despite the wire containing 2 (data + annotation).
    const rows = root.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
  });

  it('shows a per-row source badge for each origin', () => {
    const q = quad(
      namedNode('http://example.org/alice'),
      namedNode('http://example.org/knows'),
      namedNode('http://example.org/bob'),
    );
    const wire = [
      serializeDescribeWire([q]),
      serializeDescribeWire(describeProvenance.inject([q], 'alpha', FROM_SOURCE).slice(1)),
      serializeDescribeWire(describeProvenance.inject([q], 'beta', FROM_SOURCE).slice(1)),
    ].join('');
    const { root } = setup(wire, 'http://example.org/alice');
    const badges = Array.from(
      root.querySelectorAll('[data-testid="source-badge"]'),
    ).map((el) => el.textContent?.trim());
    expect(badges).toEqual(['alpha', 'beta']);
  });

  it('omits the "from" cell content when a row has no recorded origin', () => {
    const q = quad(
      namedNode('http://example.org/alice'),
      namedNode('http://example.org/knows'),
      namedNode('http://example.org/bob'),
    );
    const wire = serializeDescribeWire([q]);
    const { root } = setup(wire, 'http://example.org/alice');
    const badges = root.querySelectorAll('[data-testid="source-badge"]');
    expect(badges.length).toBe(0);
  });

  it('attaches a "describe this" affordance to each named IRI in s/p/o', () => {
    const q = quad(
      namedNode('http://example.org/alice'),
      namedNode('http://example.org/knows'),
      namedNode('http://example.org/bob'),
    );
    const { root } = setup(serializeDescribeWire([q]), 'http://example.org/alice');
    const links = Array.from(
      root.querySelectorAll<HTMLAnchorElement>('a[data-testid="describe-this"]'),
    ).map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      `/describe?iri=${encodeURIComponent('http://example.org/alice')}`,
      `/describe?iri=${encodeURIComponent('http://example.org/knows')}`,
      `/describe?iri=${encodeURIComponent('http://example.org/bob')}`,
    ]);
  });

  it('does not attach the affordance to the graph-name column', () => {
    const q = quad(
      namedNode('http://example.org/alice'),
      namedNode('http://example.org/knows'),
      namedNode('http://example.org/bob'),
      namedNode('http://example.org/g'),
    );
    const { root } = setup(serializeDescribeWire([q]), 'http://example.org/alice');
    // s, p, o get a link — the named graph does not.
    expect(root.querySelectorAll('a[data-testid="describe-this"]').length).toBe(3);
  });

  it('compacts IRIs using the display context prefixes', () => {
    const q = quad(
      namedNode('http://example.org/alice'),
      namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
      namedNode('http://example.org/Person'),
    );
    const { root } = setup(serializeDescribeWire([q]), 'http://example.org/alice', {
      prefixes: { ex: 'http://example.org/' },
    });
    const cells = Array.from(
      root.querySelectorAll<HTMLElement>('[data-testid="term-cell"]'),
    ).map((el) => el.textContent?.replace(/\s+/g, ''));
    // ex:alice / rdf:type (rdf is a default prefix) / ex:Person
    expect(cells).toEqual(['ex:alice', 'rdf:type', 'ex:Person']);
  });

  describe('blank-node expand affordance', () => {
    const SEED = 'http://example.org/alice';
    const KNOWS = 'http://example.org/knows';

    function danglingBnodeWire(label: string): string {
      return serializeDescribeWire([quad(namedNode(SEED), namedNode(KNOWS), blankNode(label))]);
    }

    it('renders an expand affordance on a dangling bnode from an endpoint source', () => {
      const { root } = setup(danglingBnodeWire('ep__b0'), SEED, undefined, ['ep']);
      expect(root.querySelector('[data-testid="expand-bnode"]')).toBeTruthy();
    });

    it('does not render the affordance on a bnode from a non-endpoint source', () => {
      const { root } = setup(danglingBnodeWire('glb__b0'), SEED, undefined, ['ep']);
      expect(root.querySelector('[data-testid="expand-bnode"]')).toBeFalsy();
    });

    it('does not render the affordance once the bnode has been expanded (has subject quads)', () => {
      const wire = [
        danglingBnodeWire('ep__b0'),
        serializeDescribeWire([
          quad(blankNode('ep__b0'), namedNode('http://example.org/since'), literal('2021')),
        ]),
      ].join('');
      const { root } = setup(wire, SEED, undefined, ['ep']);
      expect(root.querySelector('[data-testid="expand-bnode"]')).toBeFalsy();
    });

    it('hides the affordance when the path to the bnode would exceed the step cap', () => {
      // Chain seed -p0-> _:ep__b0 -p1-> _:ep__b1 -> … with > 12 hops; only the
      // last node in the chain is dangling.
      const STEPS = 14;
      const quads = [
        quad(namedNode(SEED), namedNode('http://example.org/p0'), blankNode('ep__b0')),
      ];
      for (let i = 1; i < STEPS; i++) {
        quads.push(
          quad(blankNode(`ep__b${i - 1}`), namedNode(`http://example.org/p${i}`), blankNode(`ep__b${i}`)),
        );
      }
      const { root } = setup(serializeDescribeWire(quads), SEED, undefined, ['ep']);
      // Intermediate nodes are non-dangling; the tail node is past the cap.
      expect(root.querySelector('[data-testid="expand-bnode"]')).toBeFalsy();
    });

    it('emits { sourceId, path } when the affordance is clicked', () => {
      const { fixture, root } = setup(danglingBnodeWire('ep__b0'), SEED, undefined, ['ep']);
      const emitted: { sourceId: string; path: unknown }[] = [];
      fixture.componentInstance.expand.subscribe((e) => emitted.push(e));
      (root.querySelector('[data-testid="expand-bnode"]') as HTMLButtonElement).click();
      expect(emitted).toEqual([
        { sourceId: 'ep', path: [{ predicate: KNOWS, inverse: false }] },
      ]);
    });
  });

  it('does not attach the affordance to bnodes or literals', () => {
    const q = quad(
      namedNode('http://example.org/alice'),
      namedNode('http://example.org/name'),
      literal('Alice'),
    );
    const q2 = quad(
      blankNode('b0'),
      namedNode('http://example.org/knows'),
      namedNode('http://example.org/alice'),
    );
    const wire = [serializeDescribeWire([q]), serializeDescribeWire([q2])].join('');
    const { root } = setup(wire, 'http://example.org/alice');
    const links = Array.from(
      root.querySelectorAll<HTMLAnchorElement>('a[data-testid="describe-this"]'),
    ).map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      `/describe?iri=${encodeURIComponent('http://example.org/alice')}`,
      `/describe?iri=${encodeURIComponent('http://example.org/name')}`,
      `/describe?iri=${encodeURIComponent('http://example.org/knows')}`,
      `/describe?iri=${encodeURIComponent('http://example.org/alice')}`,
    ]);
  });
});
