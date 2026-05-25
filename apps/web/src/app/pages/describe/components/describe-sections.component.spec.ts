import { TestBed } from '@angular/core/testing';
import { DataFactory, type Quad } from 'n3';
import { DescribeSectionsComponent } from './describe-sections.component';

const { namedNode, quad } = DataFactory;

const SEED = 'http://example.org/alice';

function setup(opts: { quads: readonly Quad[]; source?: string }) {
  const ref = TestBed.createComponent(DescribeSectionsComponent);
  ref.componentRef.setInput('quads', opts.quads);
  ref.componentRef.setInput('seed', SEED);
  if (opts.source !== undefined) {
    ref.componentRef.setInput('source', opts.source);
  }
  ref.detectChanges();
  return ref.nativeElement as HTMLElement;
}

function describeHrefs(el: HTMLElement): string[] {
  return Array.from(
    el.querySelectorAll<HTMLAnchorElement>('a[data-testid="describe-this"]'),
  ).map((a) => a.getAttribute('href') ?? '');
}

describe('DescribeSectionsComponent describe-link source threading', () => {
  it('appends &source= to every nested describe-link when source is set', () => {
    const q = quad(
      namedNode(SEED),
      namedNode('http://example.org/knows'),
      namedNode('http://example.org/bob'),
    );
    const el = setup({ quads: [q], source: 'people' });

    const hrefs = describeHrefs(el);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toContain('&source=people');
    }
  });

  it('emits no source param when source is the empty string (cleared picker → merged view)', () => {
    const q = quad(
      namedNode(SEED),
      namedNode('http://example.org/knows'),
      namedNode('http://example.org/bob'),
    );
    const el = setup({ quads: [q], source: '' });

    const hrefs = describeHrefs(el);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).not.toContain('source=');
    }
  });
});
