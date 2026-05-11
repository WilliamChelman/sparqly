import { TestBed } from '@angular/core/testing';
import { DataFactory } from 'n3';
import { describeProvenance, serializeDescribeWire } from 'common';
import type { DisplayContext } from '@app/core';
import { QuadTableComponent } from './quad-table.component';

const { namedNode, blankNode, literal, quad } = DataFactory;

const FROM_SOURCE = 'urn:sparqly:fromSource';

function setup(quadsText: string, seed = '', context?: DisplayContext) {
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(QuadTableComponent);
  fixture.componentRef.setInput('quadsText', quadsText);
  fixture.componentRef.setInput('seed', seed);
  if (context !== undefined) fixture.componentRef.setInput('context', context);
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
