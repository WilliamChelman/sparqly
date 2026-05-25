import { TestBed } from '@angular/core/testing';
import type { TabularDiffResponse } from '../models/diff-response';
import { DiffTabularTableComponent } from './diff-tabular-table.component';

const TWO_IRI_DIFF: TabularDiffResponse = {
  kind: 'tabular',
  diff: {
    added: [
      {
        row: {
          s: { termType: 'NamedNode', value: 'http://example.org/alice' },
        },
        count: 1,
      },
    ],
    removed: [],
    totals: { left: 0, right: 1 },
  },
  totals: { left: 0, right: 1 },
  variables: ['s'],
};

function setup(opts: { leftSourceId?: string; rightSourceId?: string } = {}) {
  const ref = TestBed.createComponent(DiffTabularTableComponent);
  ref.componentRef.setInput('result', TWO_IRI_DIFF);
  if (opts.leftSourceId !== undefined) {
    ref.componentRef.setInput('leftSourceId', opts.leftSourceId);
  }
  if (opts.rightSourceId !== undefined) {
    ref.componentRef.setInput('rightSourceId', opts.rightSourceId);
  }
  ref.detectChanges();
  return ref.nativeElement as HTMLElement;
}

function describeLinks(el: HTMLElement): HTMLAnchorElement[] {
  return Array.from(
    el.querySelectorAll<HTMLAnchorElement>('a[data-testid="describe-this"]'),
  );
}

describe('DiffTabularTableComponent describe-link source threading', () => {
  it('renders one describe-link per IRI cell when no side ids are supplied', () => {
    const el = setup();
    const links = describeLinks(el);
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(
      '/describe?iri=http%3A%2F%2Fexample.org%2Falice',
    );
  });

  it('renders two side-tagged describe-links when left and right ids differ', () => {
    const el = setup({ leftSourceId: 'people-a', rightSourceId: 'people-b' });
    const links = describeLinks(el);
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe(
      '/describe?iri=http%3A%2F%2Fexample.org%2Falice&source=people-a',
    );
    expect(links[0].getAttribute('aria-label')).toBe(
      'Describe this IRI in left source',
    );
    expect(links[1].getAttribute('href')).toBe(
      '/describe?iri=http%3A%2F%2Fexample.org%2Falice&source=people-b',
    );
    expect(links[1].getAttribute('aria-label')).toBe(
      'Describe this IRI in right source',
    );
  });

  it('collapses to a single describe-link when both sides resolve to the same source id', () => {
    const el = setup({ leftSourceId: 'people', rightSourceId: 'people' });
    const links = describeLinks(el);
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(
      '/describe?iri=http%3A%2F%2Fexample.org%2Falice&source=people',
    );
    // Default a11y label (matches the single-source affordance everywhere else).
    expect(links[0].getAttribute('aria-label')).toBe('Describe this IRI');
  });
});
