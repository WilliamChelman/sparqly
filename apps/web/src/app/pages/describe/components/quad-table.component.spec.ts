import { TestBed } from '@angular/core/testing';
import { DataFactory } from 'n3';
import { describeProvenance, serializeDescribeWire } from 'common';
import { QuadTableComponent } from './quad-table.component';

const { namedNode, quad } = DataFactory;

const FROM_SOURCE = 'urn:sparqly:fromSource';

function setup(quadsText: string, seed = '') {
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(QuadTableComponent);
  fixture.componentRef.setInput('quadsText', quadsText);
  fixture.componentRef.setInput('seed', seed);
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
});
