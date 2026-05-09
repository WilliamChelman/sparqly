import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DisplayContext } from './config.service';
import type { TripleResult } from './sparql-result-decoder';
import { ResultTableTriples } from './result-table-triples';

@Component({
  standalone: true,
  imports: [ResultTableTriples],
  template: `
    <app-result-table-triples [result]="result" [context]="context" />
  `,
})
class Host {
  result: TripleResult = {
    kind: 'triples',
    triples: [],
    raw: '',
    contentType: 'text/turtle',
  };
  context: DisplayContext = { prefixes: {} };
}

describe('ResultTableTriples', () => {
  it('renders sticky header cells: # / subject / predicate / object', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const ths = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid="triples-header-cell"]',
    );
    expect(ths.length).toBe(4);
    expect(ths[0].textContent?.trim()).toBe('#');
    expect(ths[1].textContent?.trim()).toBe('subject');
    expect(ths[2].textContent?.trim()).toBe('predicate');
    expect(ths[3].textContent?.trim()).toBe('object');
    const head = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="triples-header"]',
    );
    expect(head?.getAttribute('data-sticky')).toBe('true');
  });

  it('exposes a row-count attribute matching the triples length', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.result = {
      kind: 'triples',
      triples: [
        {
          subject: { termType: 'NamedNode', value: 'http://example.org/a' },
          predicate: { termType: 'NamedNode', value: 'http://example.org/p' },
          object: { termType: 'NamedNode', value: 'http://example.org/o' },
        },
      ],
      raw: '',
      contentType: 'text/turtle',
    };
    fixture.detectChanges();
    const root = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="result-table-triples"]',
    );
    expect(root?.getAttribute('data-row-count')).toBe('1');
  });

  it('renders a no-triples empty state when there are zero triples', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const empty = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="triples-empty"]',
    );
    expect(empty).toBeTruthy();
  });
});
