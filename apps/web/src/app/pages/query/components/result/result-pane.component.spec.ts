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

const TRIG_RESULT: DecodedResult = {
  kind: 'triples',
  triples: [
    {
      subject: { termType: 'NamedNode', value: 'http://example.org/a' },
      predicate: { termType: 'NamedNode', value: 'http://example.org/p' },
      object: { termType: 'NamedNode', value: 'http://example.org/o' },
      graph: { termType: 'NamedNode', value: 'http://example.org/g' },
    },
  ],
  raw: '<http://example.org/g> {\n<http://example.org/a> <http://example.org/p> <http://example.org/o>\n}\n',
  contentType: 'application/trig',
};

const SELECT_SPO_RESULT: DecodedResult = {
  kind: 'select',
  variables: ['s', 'p', 'o'],
  bindings: [
    {
      s: { termType: 'NamedNode', value: 'http://example.org/a' },
      p: { termType: 'NamedNode', value: 'http://example.org/p' },
      o: { termType: 'NamedNode', value: 'http://example.org/o' },
    },
  ],
  raw: '{"head":{"vars":["s","p","o"]},"results":{"bindings":[{"s":{"type":"uri","value":"http://example.org/a"},"p":{"type":"uri","value":"http://example.org/p"},"o":{"type":"uri","value":"http://example.org/o"}}]}}',
  contentType: 'application/sparql-results+json',
};

const SELECT_SPOG_RESULT: DecodedResult = {
  kind: 'select',
  variables: ['s', 'p', 'o', 'g'],
  bindings: [
    {
      s: { termType: 'NamedNode', value: 'http://example.org/a' },
      p: { termType: 'NamedNode', value: 'http://example.org/p' },
      o: { termType: 'NamedNode', value: 'http://example.org/o' },
      g: { termType: 'NamedNode', value: 'http://example.org/g' },
    },
  ],
  raw: '{"head":{"vars":["s","p","o","g"]},"results":{"bindings":[{"s":{"type":"uri","value":"http://example.org/a"},"p":{"type":"uri","value":"http://example.org/p"},"o":{"type":"uri","value":"http://example.org/o"},"g":{"type":"uri","value":"http://example.org/g"}}]}}',
  contentType: 'application/sparql-results+json',
};

const SELECT_SPO_EMPTY_RESULT: DecodedResult = {
  kind: 'select',
  variables: ['s', 'p', 'o'],
  bindings: [],
  raw: '{"head":{"vars":["s","p","o"]},"results":{"bindings":[]}}',
  contentType: 'application/sparql-results+json',
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

describe('ResultPane turtle/trig tab', () => {
  it('shows a turtle tab between table and raw for a default-graph triple result', () => {
    const fixture = setup({ kind: 'result', result: TRIPLE_RESULT });
    const tabs = $$(fixture, '[data-testid^="tab-"]');
    const ids = tabs.map((t) => t.getAttribute('data-testid'));
    expect(ids).toEqual(['tab-table', 'tab-turtle', 'tab-raw', 'tab-download']);
    expect(
      $(fixture, '[data-testid="tab-turtle"]')?.textContent?.trim(),
    ).toBe('turtle');
  });

  it('labels the tab `trig` when any quad carries a named graph', () => {
    const fixture = setup({ kind: 'result', result: TRIG_RESULT });
    const tabs = $$(fixture, '[data-testid^="tab-"]');
    const ids = tabs.map((t) => t.getAttribute('data-testid'));
    expect(ids).toEqual(['tab-table', 'tab-trig', 'tab-raw', 'tab-download']);
    expect(
      $(fixture, '[data-testid="tab-trig"]')?.textContent?.trim(),
    ).toBe('trig');
  });

  it('hides the turtle/trig tab for SELECT results', () => {
    const fixture = setup({ kind: 'result', result: SELECT_RESULT });
    expect($(fixture, '[data-testid="tab-turtle"]')).toBeFalsy();
    expect($(fixture, '[data-testid="tab-trig"]')).toBeFalsy();
  });

  it('hides the turtle/trig tab for ASK results', () => {
    const fixture = setup({ kind: 'result', result: ASK_RESULT });
    expect($(fixture, '[data-testid="tab-turtle"]')).toBeFalsy();
    expect($(fixture, '[data-testid="tab-trig"]')).toBeFalsy();
  });

  it('renders the formatted body when the turtle tab is active', () => {
    const fixture = setup({ kind: 'result', result: TRIPLE_RESULT });
    ($(fixture, '[data-testid="tab-turtle"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const body = $(fixture, '[data-testid="result-formatted-body"]');
    expect(body).toBeTruthy();
    expect(body?.textContent).toContain('<http://example.org/a>');
    expect(body?.textContent).toContain('<http://example.org/p>');
    expect(body?.textContent).toContain('<http://example.org/o>');
  });

  it('renders the formatted body for a TriG result', () => {
    const fixture = setup({ kind: 'result', result: TRIG_RESULT });
    ($(fixture, '[data-testid="tab-trig"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const body = $(fixture, '[data-testid="result-formatted-body"]');
    expect(body).toBeTruthy();
    expect(body?.textContent).toContain('<http://example.org/g>');
    expect(body?.textContent).toContain('<http://example.org/a>');
  });
});

describe('ResultPane formatted-body downloads', () => {
  it('serves the formatted body for the Turtle download on default-graph triples', () => {
    const fixture = setup({ kind: 'result', result: TRIPLE_RESULT });
    ($(fixture, '[data-testid="tab-download"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const turtle = $(fixture, '[data-testid="download-turtle"]') as HTMLAnchorElement;
    expect(turtle.getAttribute('download')).toBe('result.ttl');
    expect(turtle.textContent).toContain('Turtle');
    const href = turtle.getAttribute('href') ?? '';
    expect(href.startsWith('data:text/turtle')).toBe(true);
    const decoded = decodeURIComponent(href.replace(/^data:[^,]+,/, ''));
    // Body is the formatRdf output, not the raw wire body.
    expect(decoded).toContain('<http://example.org/a>');
    expect(decoded).toContain('<http://example.org/p>');
    expect(decoded).toContain('<http://example.org/o>');
  });

  it('flips Turtle to TriG for named-graph results', () => {
    const fixture = setup({ kind: 'result', result: TRIG_RESULT });
    ($(fixture, '[data-testid="tab-download"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const trig = $(fixture, '[data-testid="download-turtle"]') as HTMLAnchorElement;
    expect(trig.getAttribute('download')).toBe('result.trig');
    expect(trig.textContent).toContain('TriG');
    const href = trig.getAttribute('href') ?? '';
    expect(href.startsWith('data:application/trig')).toBe(true);
  });

  it('keeps the N-Quads download entry untouched', () => {
    const fixture = setup({ kind: 'result', result: TRIPLE_RESULT });
    ($(fixture, '[data-testid="tab-download"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const nq = $(fixture, '[data-testid="download-nquads"]') as HTMLAnchorElement;
    expect(nq.getAttribute('download')).toBe('result.nq');
    const href = nq.getAttribute('href') ?? '';
    expect(href.startsWith('data:application/n-quads')).toBe(true);
  });
});

describe('ResultPane SELECT-spo turtle/trig tab', () => {
  it('shows a turtle tab for a SELECT projecting {s,p,o}', () => {
    const fixture = setup({ kind: 'result', result: SELECT_SPO_RESULT });
    const tabs = $$(fixture, '[data-testid^="tab-"]');
    const ids = tabs.map((t) => t.getAttribute('data-testid'));
    expect(ids).toEqual(['tab-table', 'tab-turtle', 'tab-raw', 'tab-download']);
  });

  it('labels the tab `trig` when SELECT-spog rows carry named graphs', () => {
    const fixture = setup({ kind: 'result', result: SELECT_SPOG_RESULT });
    const tabs = $$(fixture, '[data-testid^="tab-"]');
    const ids = tabs.map((t) => t.getAttribute('data-testid'));
    expect(ids).toEqual(['tab-table', 'tab-trig', 'tab-raw', 'tab-download']);
  });

  it('hides the turtle tab for a non-spo SELECT result', () => {
    const fixture = setup({ kind: 'result', result: SELECT_RESULT });
    expect($(fixture, '[data-testid="tab-turtle"]')).toBeFalsy();
    expect($(fixture, '[data-testid="tab-trig"]')).toBeFalsy();
  });

  it('hides the turtle tab for an empty-bindings SELECT-spo result', () => {
    const fixture = setup({ kind: 'result', result: SELECT_SPO_EMPTY_RESULT });
    expect($(fixture, '[data-testid="tab-turtle"]')).toBeFalsy();
    expect($(fixture, '[data-testid="tab-trig"]')).toBeFalsy();
  });

  it('renders the formatted body when the SELECT-spo turtle tab is active', () => {
    const fixture = setup({ kind: 'result', result: SELECT_SPO_RESULT });
    ($(fixture, '[data-testid="tab-turtle"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const body = $(fixture, '[data-testid="result-formatted-body"]');
    expect(body).toBeTruthy();
    expect(body?.textContent).toContain('<http://example.org/a>');
    expect(body?.textContent).toContain('<http://example.org/p>');
    expect(body?.textContent).toContain('<http://example.org/o>');
  });

  it('exposes a Turtle download alongside csv/tsv/json for SELECT-spo', () => {
    const fixture = setup({ kind: 'result', result: SELECT_SPO_RESULT });
    ($(fixture, '[data-testid="tab-download"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const links = $$(fixture, '[data-testid^="download-"]');
    const ids = links.map((l) => l.getAttribute('data-testid')).sort();
    expect(ids).toEqual([
      'download-csv',
      'download-json',
      'download-tsv',
      'download-turtle',
    ]);
    const turtle = $(fixture, '[data-testid="download-turtle"]') as HTMLAnchorElement;
    expect(turtle.getAttribute('download')).toBe('result.ttl');
    const href = turtle.getAttribute('href') ?? '';
    expect(href.startsWith('data:text/turtle')).toBe(true);
    const decoded = decodeURIComponent(href.replace(/^data:[^,]+,/, ''));
    expect(decoded).toContain('<http://example.org/a>');
  });

  it('flips the Turtle entry to TriG for SELECT-spog with named graphs', () => {
    const fixture = setup({ kind: 'result', result: SELECT_SPOG_RESULT });
    ($(fixture, '[data-testid="tab-download"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const trig = $(fixture, '[data-testid="download-turtle"]') as HTMLAnchorElement;
    expect(trig.getAttribute('download')).toBe('result.trig');
    expect(trig.textContent).toContain('TriG');
    const href = trig.getAttribute('href') ?? '';
    expect(href.startsWith('data:application/trig')).toBe(true);
  });

  it('keeps the SELECT download set unchanged for non-spo SELECT results', () => {
    const fixture = setup({ kind: 'result', result: SELECT_RESULT });
    ($(fixture, '[data-testid="tab-download"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const links = $$(fixture, '[data-testid^="download-"]');
    const ids = links.map((l) => l.getAttribute('data-testid')).sort();
    expect(ids).toEqual(['download-csv', 'download-json', 'download-tsv']);
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
