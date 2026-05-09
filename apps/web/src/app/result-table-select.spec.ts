import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DisplayContext } from './config.service';
import type { SelectResult } from './sparql-result-decoder';
import { ResultTableSelect } from './result-table-select';

@Component({
  standalone: true,
  imports: [ResultTableSelect],
  template: `
    <app-result-table-select [result]="result" [context]="context" />
  `,
})
class Host {
  result: SelectResult = {
    kind: 'select',
    variables: [],
    bindings: [],
    raw: '',
    contentType: 'application/sparql-results+json',
  };
  context: DisplayContext = { prefixes: {} };
}

describe('ResultTableSelect', () => {
  it('renders one header cell per projection variable, in order', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.result = {
      kind: 'select',
      variables: ['s', 'p', 'o'],
      bindings: [],
      raw: '',
      contentType: 'application/sparql-results+json',
    };
    fixture.detectChanges();
    const ths = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid="select-header-cell"]',
    );
    // First cell is the row-number indicator (#), then one per variable.
    expect(ths.length).toBe(4);
    expect(ths[0].textContent?.trim()).toBe('#');
    expect(ths[1].textContent?.trim()).toBe('?s');
    expect(ths[2].textContent?.trim()).toBe('?p');
    expect(ths[3].textContent?.trim()).toBe('?o');
  });

  it('exposes a row-count attribute matching the bindings length', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.result = {
      kind: 'select',
      variables: ['s'],
      bindings: [
        { s: { termType: 'NamedNode', value: 'http://example.org/a' } },
        { s: { termType: 'NamedNode', value: 'http://example.org/b' } },
      ],
      raw: '',
      contentType: 'application/sparql-results+json',
    };
    fixture.detectChanges();
    const root = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="result-table-select"]',
    );
    expect(root?.getAttribute('data-row-count')).toBe('2');
  });

  it('marks the header row as sticky', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.result = {
      kind: 'select',
      variables: ['s'],
      bindings: [],
      raw: '',
      contentType: 'application/sparql-results+json',
    };
    fixture.detectChanges();
    const head = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="select-header"]',
    );
    expect(head?.getAttribute('data-sticky')).toBe('true');
  });

  it('renders an empty-state node when there are zero rows', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.result = {
      kind: 'select',
      variables: ['s'],
      bindings: [],
      raw: '',
      contentType: 'application/sparql-results+json',
    };
    fixture.detectChanges();
    const empty = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="select-empty"]',
    );
    expect(empty).toBeTruthy();
  });
});
