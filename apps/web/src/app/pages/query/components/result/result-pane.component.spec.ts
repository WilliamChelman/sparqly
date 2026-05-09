import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DecodedResult, DisplayContext } from '@app/core';
import {
  ResultPaneComponent,
  type ResultPaneState,
} from './result-pane.component';

@Component({
  standalone: true,
  imports: [ResultPaneComponent],
  template: `
    <app-result-pane [state]="state" [context]="context" />
  `,
})
class Host {
  state: ResultPaneState = { kind: 'empty' };
  context: DisplayContext = { prefixes: {} };
}

const SELECT_RESULT: DecodedResult = {
  kind: 'select',
  variables: ['s'],
  bindings: [
    { s: { termType: 'NamedNode', value: 'http://example.org/a' } },
  ],
  raw: '{"head":{"vars":["s"]},"results":{"bindings":[{"s":{"type":"uri","value":"http://example.org/a"}}]}}',
  contentType: 'application/sparql-results+json',
};

const ASK_RESULT: DecodedResult = {
  kind: 'ask',
  value: true,
  raw: '{"head":{},"boolean":true}',
  contentType: 'application/sparql-results+json',
};

const TRIPLE_RESULT: DecodedResult = {
  kind: 'triples',
  triples: [
    {
      subject: { termType: 'NamedNode', value: 'http://example.org/a' },
      predicate: { termType: 'NamedNode', value: 'http://example.org/p' },
      object: { termType: 'NamedNode', value: 'http://example.org/o' },
    },
  ],
  raw: '<http://example.org/a> <http://example.org/p> <http://example.org/o> .\n',
  contentType: 'text/turtle',
};

function setup(state: ResultPaneState) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.state = state;
  fixture.detectChanges();
  return fixture;
}

function $(fixture: { nativeElement: HTMLElement }, sel: string): HTMLElement | null {
  return fixture.nativeElement.querySelector(sel) as HTMLElement | null;
}

function $$(
  fixture: { nativeElement: HTMLElement },
  sel: string,
): HTMLElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll(sel)) as HTMLElement[];
}

describe('ResultPane states', () => {
  it('renders the empty state when state.kind is empty', () => {
    const fixture = setup({ kind: 'empty' });
    expect($(fixture, '[data-testid="result-empty"]')).toBeTruthy();
    expect($(fixture, '[data-testid="result-loading"]')).toBeFalsy();
  });

  it('renders the loading state with a loading-constellation when state.kind is loading', () => {
    const fixture = setup({ kind: 'loading' });
    expect($(fixture, '[data-testid="result-loading"]')).toBeTruthy();
    expect($(fixture, 'app-loading-constellation')).toBeTruthy();
  });

  it('renders the error state with the server message when state.kind is error', () => {
    const fixture = setup({ kind: 'error', message: 'boom' });
    const err = $(fixture, '[data-testid="result-error"]');
    expect(err).toBeTruthy();
    expect(err?.textContent).toContain('boom');
    expect($(fixture, 'app-error-constellation')).toBeTruthy();
  });
});

describe('ResultPane tabs', () => {
  it('renders table / raw / download tab buttons in result mode', () => {
    const fixture = setup({ kind: 'result', result: SELECT_RESULT });
    const tabs = $$(fixture, '[data-testid^="tab-"]');
    const ids = tabs.map((t) => t.getAttribute('data-testid'));
    expect(ids).toEqual(['tab-table', 'tab-raw', 'tab-download']);
  });

  it('starts on the table tab and renders the SELECT table for a SELECT result', () => {
    const fixture = setup({ kind: 'result', result: SELECT_RESULT });
    expect($(fixture, '[data-testid="result-table-select"]')).toBeTruthy();
  });

  it('renders the triples table for a CONSTRUCT/DESCRIBE result', () => {
    const fixture = setup({ kind: 'result', result: TRIPLE_RESULT });
    expect($(fixture, '[data-testid="result-table-triples"]')).toBeTruthy();
  });

  it('renders the ASK card for an ASK result', () => {
    const fixture = setup({ kind: 'result', result: ASK_RESULT });
    expect($(fixture, '[data-testid="result-ask"]')).toBeTruthy();
  });

  it('switches to raw when the raw tab is clicked', () => {
    const fixture = setup({ kind: 'result', result: SELECT_RESULT });
    ($(fixture, '[data-testid="tab-raw"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect($(fixture, '[data-testid="result-raw"]')).toBeTruthy();
    expect($(fixture, '[data-testid="result-table-select"]')).toBeFalsy();
  });
});

describe('ResultPane download tab', () => {
  it('offers CSV / TSV / JSON downloads for a SELECT result', () => {
    const fixture = setup({ kind: 'result', result: SELECT_RESULT });
    ($(fixture, '[data-testid="tab-download"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const links = $$(fixture, '[data-testid^="download-"]');
    const ids = links.map((l) => l.getAttribute('data-testid')).sort();
    expect(ids).toEqual(['download-csv', 'download-json', 'download-tsv']);
  });

  it('offers only JSON for an ASK result', () => {
    const fixture = setup({ kind: 'result', result: ASK_RESULT });
    ($(fixture, '[data-testid="tab-download"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const links = $$(fixture, '[data-testid^="download-"]');
    const ids = links.map((l) => l.getAttribute('data-testid')).sort();
    expect(ids).toEqual(['download-json']);
  });

  it('offers Turtle / N-Quads for a triple result', () => {
    const fixture = setup({ kind: 'result', result: TRIPLE_RESULT });
    ($(fixture, '[data-testid="tab-download"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const links = $$(fixture, '[data-testid^="download-"]');
    const ids = links.map((l) => l.getAttribute('data-testid')).sort();
    expect(ids).toEqual(['download-nquads', 'download-turtle']);
  });

  it('produces RFC4180 CSV bodies for SELECT downloads', () => {
    const fixture = setup({ kind: 'result', result: SELECT_RESULT });
    ($(fixture, '[data-testid="tab-download"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const csv = $(fixture, '[data-testid="download-csv"]') as HTMLAnchorElement;
    expect(csv.getAttribute('download')).toBe('result.csv');
    const href = csv.getAttribute('href') ?? '';
    const decoded = decodeURIComponent(href.replace(/^data:[^,]+,/, ''));
    expect(decoded).toBe('s\r\n<http://example.org/a>\r\n');
  });
});
