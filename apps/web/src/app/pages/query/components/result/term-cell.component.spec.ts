import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Term } from '@app/core';
import { TermCellComponent } from './term-cell.component';

@Component({
  standalone: true,
  imports: [TermCellComponent],
  template: `<app-term-cell [term]="term" [source]="source" />`,
})
class Host {
  term: Term | null = { termType: 'NamedNode', value: 'http://example.org/alice' };
  source: string | undefined = undefined;
}

function setup(term: Term | null, source?: string) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.term = term;
  fixture.componentInstance.source = source;
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('TermCellComponent describe-link wiring', () => {
  it('forwards source to the describe-link so the URL carries &source=', () => {
    const el = setup(
      { termType: 'NamedNode', value: 'http://example.org/alice' },
      'people',
    );
    const a = el.querySelector<HTMLAnchorElement>('a[data-testid="describe-this"]');
    expect(a?.getAttribute('href')).toBe(
      '/describe?iri=http%3A%2F%2Fexample.org%2Falice&source=people',
    );
  });

  it('omits the source param when source is unset', () => {
    const el = setup({ termType: 'NamedNode', value: 'http://example.org/alice' });
    const a = el.querySelector<HTMLAnchorElement>('a[data-testid="describe-this"]');
    expect(a?.getAttribute('href')).toBe(
      '/describe?iri=http%3A%2F%2Fexample.org%2Falice',
    );
  });
});
