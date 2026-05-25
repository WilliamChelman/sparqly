import { TestBed } from '@angular/core/testing';
import type { DecodedResult, DisplayContext } from '@app/core';
import {
  ResultPaneComponent,
  type ResultPaneState,
} from './result-pane.component';

const SELECT_RESULT: DecodedResult = {
  kind: 'select',
  variables: ['s'],
  bindings: [{ s: { termType: 'NamedNode', value: 'http://example.org/a' } }],
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
  raw: '{}',
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
  raw: '{}',
  contentType: 'application/sparql-results+json',
};

const SELECT_SPO_EMPTY_RESULT: DecodedResult = {
  kind: 'select',
  variables: ['s', 'p', 'o'],
  bindings: [],
  raw: '{}',
  contentType: 'application/sparql-results+json',
};

const RAW_RESULT: DecodedResult = {
  kind: 'raw',
  raw: '<rdf:RDF><rdf:Description/></rdf:RDF>',
  contentType: 'application/rdf+xml',
};

const HUGE_LITERAL = 'x'.repeat(400_001);
const OVERSIZED_TRIPLE_RESULT: DecodedResult = {
  kind: 'triples',
  triples: [
    {
      subject: { termType: 'NamedNode', value: 'http://example.org/a' },
      predicate: { termType: 'NamedNode', value: 'http://example.org/p' },
      object: { termType: 'NamedNode', value: 'http://example.org/o' },
    },
  ],
  raw: `<http://example.org/a> <http://example.org/p> "${HUGE_LITERAL}" .\n`,
  contentType: 'text/turtle',
};

function createPane(
  state: ResultPaneState,
  context: DisplayContext = { prefixes: {} },
): ResultPaneComponent {
  const ref = TestBed.createComponent(ResultPaneComponent);
  ref.componentRef.setInput('state', state);
  ref.componentRef.setInput('context', context);
  return ref.componentInstance;
}

function createPaneFixture(
  state: ResultPaneState,
  opts: { context?: DisplayContext; source?: string } = {},
) {
  const ref = TestBed.createComponent(ResultPaneComponent);
  ref.componentRef.setInput('state', state);
  ref.componentRef.setInput('context', opts.context ?? { prefixes: {} });
  if (opts.source !== undefined) {
    ref.componentRef.setInput('source', opts.source);
  }
  ref.detectChanges();
  return ref;
}

describe('ResultPaneComponent state surface', () => {
  it('exposes the error message for the error state', () => {
    const pane = createPane({ kind: 'error', message: 'boom' });
    expect(pane.errorMessage()).toBe('boom');
  });

  it('errorMessage is empty when not in the error state', () => {
    expect(createPane({ kind: 'empty' }).errorMessage()).toBe('');
    expect(createPane({ kind: 'loading' }).errorMessage()).toBe('');
    expect(
      createPane({ kind: 'result', result: SELECT_RESULT }).errorMessage(),
    ).toBe('');
  });

  it('currentResult tracks the result payload only for the result state', () => {
    expect(createPane({ kind: 'empty' }).currentResult()).toBeNull();
    expect(createPane({ kind: 'loading' }).currentResult()).toBeNull();
    expect(
      createPane({ kind: 'error', message: 'x' }).currentResult(),
    ).toBeNull();
    expect(
      createPane({ kind: 'result', result: SELECT_RESULT }).currentResult(),
    ).toBe(SELECT_RESULT);
  });
});

describe('ResultPaneComponent tab list', () => {
  function tabIds(state: ResultPaneState): string[] {
    return createPane(state)
      .tabs()
      .map((t) => t.testId);
  }

  it('defaults to the table tab', () => {
    expect(
      createPane({ kind: 'result', result: SELECT_RESULT }).activeTab(),
    ).toBe('table');
  });

  it('renders table/raw/download for a plain SELECT result', () => {
    expect(tabIds({ kind: 'result', result: SELECT_RESULT })).toEqual([
      'table',
      'raw',
      'download',
    ]);
  });

  it('inserts a turtle tab between table and raw for default-graph triples', () => {
    expect(tabIds({ kind: 'result', result: TRIPLE_RESULT })).toEqual([
      'table',
      'turtle',
      'raw',
      'download',
    ]);
  });

  it('inserts a trig tab when any quad carries a named graph', () => {
    expect(tabIds({ kind: 'result', result: TRIG_RESULT })).toEqual([
      'table',
      'trig',
      'raw',
      'download',
    ]);
  });

  it('hides the turtle/trig tab for ASK results', () => {
    expect(tabIds({ kind: 'result', result: ASK_RESULT })).toEqual([
      'table',
      'raw',
      'download',
    ]);
  });

  it('inserts a turtle tab for a SELECT projecting {s,p,o}', () => {
    expect(tabIds({ kind: 'result', result: SELECT_SPO_RESULT })).toEqual([
      'table',
      'turtle',
      'raw',
      'download',
    ]);
  });

  it('labels the SELECT-spog tab `trig`', () => {
    expect(tabIds({ kind: 'result', result: SELECT_SPOG_RESULT })).toEqual([
      'table',
      'trig',
      'raw',
      'download',
    ]);
  });

  it('hides the turtle tab for an empty-bindings SELECT-spo result', () => {
    expect(tabIds({ kind: 'result', result: SELECT_SPO_EMPTY_RESULT })).toEqual(
      ['table', 'raw', 'download'],
    );
  });

  it('setTab moves activeTab', () => {
    const pane = createPane({ kind: 'result', result: TRIPLE_RESULT });
    pane.setTab('raw');
    expect(pane.activeTab()).toBe('raw');
    pane.setTab('turtle');
    expect(pane.activeTab()).toBe('turtle');
  });
});

describe('ResultPaneComponent serialization', () => {
  it('is null for SELECT results that do not project spo', () => {
    expect(
      createPane({ kind: 'result', result: SELECT_RESULT }).serialization(),
    ).toBeNull();
  });

  it('is turtle for default-graph triples', () => {
    expect(
      createPane({ kind: 'result', result: TRIPLE_RESULT }).serialization(),
    ).toBe('turtle');
  });

  it('is trig for named-graph triples', () => {
    expect(
      createPane({ kind: 'result', result: TRIG_RESULT }).serialization(),
    ).toBe('trig');
  });

  it('is turtle for SELECT-spo', () => {
    expect(
      createPane({ kind: 'result', result: SELECT_SPO_RESULT }).serialization(),
    ).toBe('turtle');
  });

  it('is trig for SELECT-spog', () => {
    expect(
      createPane({
        kind: 'result',
        result: SELECT_SPOG_RESULT,
      }).serialization(),
    ).toBe('trig');
  });
});

describe('ResultPaneComponent headerMeta', () => {
  it('shows row + var counts for SELECT', () => {
    expect(
      createPane({ kind: 'result', result: SELECT_RESULT }).headerMeta(),
    ).toBe('1 rows · 1 vars');
  });

  it('shows triple count for triples', () => {
    expect(
      createPane({ kind: 'result', result: TRIPLE_RESULT }).headerMeta(),
    ).toBe('1 triples');
  });

  it('shows the boolean for ASK', () => {
    expect(
      createPane({ kind: 'result', result: ASK_RESULT }).headerMeta(),
    ).toBe('true');
  });

  it('shows the content type for raw', () => {
    expect(
      createPane({ kind: 'result', result: RAW_RESULT }).headerMeta(),
    ).toBe('application/rdf+xml');
  });
});

describe('ResultPaneComponent downloadOptions', () => {
  function ids(state: ResultPaneState): string[] {
    return createPane(state)
      .downloadOptions()
      .map((d) => d.id)
      .sort();
  }

  it('offers csv/tsv/json for plain SELECT', () => {
    expect(ids({ kind: 'result', result: SELECT_RESULT })).toEqual([
      'csv',
      'json',
      'tsv',
    ]);
  });

  it('offers json for ASK', () => {
    expect(ids({ kind: 'result', result: ASK_RESULT })).toEqual(['json']);
  });

  it('offers turtle + n-quads for default-graph triples', () => {
    expect(ids({ kind: 'result', result: TRIPLE_RESULT })).toEqual([
      'nquads',
      'turtle',
    ]);
  });

  it('exposes a turtle download alongside csv/tsv/json for SELECT-spo', () => {
    // SELECT-spo only adds the formatted download once the active tab is
    // turtle or download — formatted() is lazy. Trigger it before reading.
    const pane = createPane({ kind: 'result', result: SELECT_SPO_RESULT });
    pane.setTab('download');
    const out = pane
      .downloadOptions()
      .map((d) => d.id)
      .sort();
    expect(out).toEqual(['csv', 'json', 'tsv', 'turtle']);
  });
});

describe('ResultPaneComponent download URLs', () => {
  it('encodes the body into a data URL using the option mediaType', () => {
    const pane = createPane({ kind: 'result', result: SELECT_RESULT });
    const csv = pane.downloadOptions().find((o) => o.id === 'csv');
    expect(csv).toBeDefined();
    const url = pane.dataUrlFor(csv!);
    expect(url.startsWith(`data:${csv!.mediaType};charset=utf-8,`)).toBe(true);
    expect(decodeURIComponent(url.replace(/^data:[^,]+,/, ''))).toBe(csv!.body);
  });

  it('produces an RFC4180 CSV body for SELECT downloads', () => {
    const pane = createPane({ kind: 'result', result: SELECT_RESULT });
    const csv = pane.downloadOptions().find((o) => o.id === 'csv');
    expect(csv!.filename).toBe('result.csv');
    expect(csv!.body).toBe('s\r\n<http://example.org/a>\r\n');
  });

  it('serves the formatted Turtle body for the Turtle download on default-graph triples', () => {
    const pane = createPane({ kind: 'result', result: TRIPLE_RESULT });
    pane.setTab('download');
    const turtle = pane.downloadOptions().find((o) => o.id === 'turtle');
    expect(turtle!.filename).toBe('result.ttl');
    expect(turtle!.mediaType).toBe('text/turtle');
    expect(turtle!.body).toContain('<http://example.org/a>');
    expect(turtle!.body).toContain('<http://example.org/p>');
    expect(turtle!.body).toContain('<http://example.org/o>');
  });

  it('flips Turtle to TriG for named-graph triples', () => {
    const pane = createPane({ kind: 'result', result: TRIG_RESULT });
    pane.setTab('download');
    const trig = pane.downloadOptions().find((o) => o.id === 'turtle');
    expect(trig!.filename).toBe('result.trig');
    expect(trig!.mediaType).toBe('application/trig');
  });
});

describe('ResultPaneComponent formatted body', () => {
  it('returns null on the table tab — formatted() is lazy', () => {
    const pane = createPane({ kind: 'result', result: TRIPLE_RESULT });
    expect(pane.formatted()).toBeNull();
  });

  it('produces the formatted turtle body when the turtle tab is active', () => {
    const pane = createPane({ kind: 'result', result: TRIPLE_RESULT });
    pane.setTab('turtle');
    const f = pane.formatted();
    expect(f).not.toBeNull();
    expect(f!.serialization).toBe('turtle');
    expect(f!.body).toContain('<http://example.org/a>');
  });

  it('produces a formatted body for SELECT-spo on the turtle tab', () => {
    const pane = createPane({ kind: 'result', result: SELECT_SPO_RESULT });
    pane.setTab('turtle');
    const f = pane.formatted();
    expect(f).not.toBeNull();
    expect(f!.body).toContain('<http://example.org/a>');
    expect(f!.body).toContain('<http://example.org/p>');
    expect(f!.body).toContain('<http://example.org/o>');
  });
});

describe('ResultPaneComponent highlight lines', () => {
  it('produces raw highlight lines for a JSON SELECT body on the raw tab', () => {
    const pane = createPane({ kind: 'result', result: SELECT_RESULT });
    pane.setTab('raw');
    expect(pane.rawHighlightLines()).not.toBeNull();
  });

  it('returns null for an unrecognised raw content type so the caller renders plain text', () => {
    const pane = createPane({ kind: 'result', result: RAW_RESULT });
    pane.setTab('raw');
    expect(pane.rawHighlightLines()).toBeNull();
  });

  it('falls back to null for a formatted body above the size threshold', () => {
    const pane = createPane({ kind: 'result', result: OVERSIZED_TRIPLE_RESULT });
    pane.setTab('turtle');
    expect(pane.formattedHighlightLines()).toBeNull();
  });

  it('produces formatted highlight lines for a normal-size turtle body', () => {
    const pane = createPane({ kind: 'result', result: TRIPLE_RESULT });
    pane.setTab('turtle');
    expect(pane.formattedHighlightLines()).not.toBeNull();
  });
});

describe('ResultPaneComponent describe-link source threading', () => {
  function firstDescribeHref(el: HTMLElement): string | null {
    return el
      .querySelector<HTMLAnchorElement>('a[data-testid="describe-this"]')
      ?.getAttribute('href') ?? null;
  }

  it('forwards source through the SELECT table to every describe-link', () => {
    const ref = createPaneFixture(
      { kind: 'result', result: SELECT_RESULT },
      { source: 'people' },
    );
    const href = firstDescribeHref(ref.nativeElement as HTMLElement);
    expect(href).toBe(
      '/describe?iri=http%3A%2F%2Fexample.org%2Fa&source=people',
    );
  });

  it('forwards source through the triples table to every describe-link', () => {
    const ref = createPaneFixture(
      { kind: 'result', result: TRIPLE_RESULT },
      { source: 'people' },
    );
    const href = firstDescribeHref(ref.nativeElement as HTMLElement);
    expect(href).toBe(
      '/describe?iri=http%3A%2F%2Fexample.org%2Fa&source=people',
    );
  });

  it('omits the source param when no source is supplied (merged-view default)', () => {
    const ref = createPaneFixture({ kind: 'result', result: SELECT_RESULT });
    const href = firstDescribeHref(ref.nativeElement as HTMLElement);
    expect(href).toBe('/describe?iri=http%3A%2F%2Fexample.org%2Fa');
  });
});
