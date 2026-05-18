import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { SourcesPickerComponent } from '@app/modules/sources-picker';
import { EditorFrameComponent } from './components/editor-frame.component';
import { QueryPage } from './query.page';
import {
  ResultPaneComponent,
  type ResultPaneState,
} from './components/result/result-pane.component';
import {
  ConfigService,
  SavedQueriesService,
  type ConfigPayload,
  type DisplayContext,
  type LoadedSavedQuery,
  type SavedQueryEntry,
  type SavedQuerySummary,
  type SourceListing,
} from '@app/core';
import type {
  ParameterBindings,
  ParameterDeclaration,
} from 'common';
import { LibraryComboboxComponent } from '@app/modules/library-combobox';

@Component({
  selector: 'app-sources-picker',
  standalone: true,
  template: `<div [attr.data-testid]="'stub-picker-' + label">
    {{ label }}:{{ value }}
  </div>`,
})
class SourcesPickerStub {
  @Input() label = 'source';
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();
}

@Component({
  selector: 'app-editor-frame',
  standalone: true,
  template: `<textarea
      [value]="value"
      (input)="valueChange.emit($any($event.target).value)"
    ></textarea>
    @if (loadError) {
      <span data-testid="stub-editor-load-error"
        >{{ loadError.kind }}: {{ loadError.slug }}</span
      >
    }`,
})
class EditorFrameStub {
  @Input() value = '';
  @Input() name = 'query';
  @Input() loadError?: { kind: 'not-found'; slug: string };
  @Input() parameters?: ReadonlyArray<ParameterDeclaration>;
  @Input() initialBindings?: ParameterBindings;
  @Output() valueChange = new EventEmitter<string>();
  @Output() submitBindings = new EventEmitter<ParameterBindings>();
}

@Component({
  selector: 'app-library-combobox',
  standalone: true,
  template: `<div data-testid="stub-library">
    <span data-testid="stub-library-selected">{{ selectedSlug ?? '' }}</span>
    @for (e of entries; track e.slug) {
      <span data-testid="stub-library-entry">{{ e.slug }}</span>
    }
  </div>`,
})
class LibraryComboboxStub {
  @Input() entries: readonly SavedQuerySummary[] = [];
  @Input() selectedSlug: string | null = null;
  // eslint-disable-next-line @angular-eslint/no-output-native
  @Output() load = new EventEmitter<string>();
}

@Component({
  selector: 'app-result-pane',
  standalone: true,
  template: `<div
    data-testid="stub-result-pane"
    [attr.data-state-kind]="state?.kind ?? ''"
    [attr.data-state-message]="state && state.kind === 'error' ? state.message : ''"
    [attr.data-result-kind]="state && state.kind === 'result' ? state.result.kind : ''"
    [attr.data-result-content-type]="
      state && state.kind === 'result' ? state.result.contentType : ''
    "
  ></div>`,
})
class ResultPaneStub {
  @Input() state: ResultPaneState | null = null;
  @Input() context: DisplayContext = { prefixes: {} };
}

const TWO: SourceListing = {
  sources: [
    { id: 'a', kind: 'glob', label: 'A (glob)' },
    { id: 'b', kind: 'glob', label: 'B (glob)', default: true },
  ],
};

interface SavedQueriesStubState {
  list: SavedQuerySummary[];
  entries: Record<string, { entry: SavedQueryEntry; etag: string }>;
  calls: {
    list: number;
    get: Array<{ slug: string }>;
  };
}

function makeSavedQueriesStub(
  initial: Partial<SavedQueriesStubState> = {},
): {
  state: SavedQueriesStubState;
  service: Pick<SavedQueriesService, 'list' | 'get'>;
} {
  const state: SavedQueriesStubState = {
    list: initial.list ?? [],
    entries: initial.entries ?? {},
    calls: { list: 0, get: [] },
  };
  const service: Pick<SavedQueriesService, 'list' | 'get'> = {
    list: () => {
      state.calls.list += 1;
      return of(state.list as readonly SavedQuerySummary[]);
    },
    get: (slug: string) => {
      state.calls.get.push({ slug });
      const found = state.entries[slug];
      if (!found) {
        return throwError(
          () =>
            new HttpErrorResponse({
              status: 404,
              statusText: 'Not Found',
              url: `/api/saved-queries/${slug}`,
            }),
        );
      }
      return of<LoadedSavedQuery>({ entry: found.entry, etag: found.etag });
    },
  };
  return { state, service };
}

async function setup(
  listing: SourceListing,
  initialUrl = '/query',
  context: DisplayContext = { prefixes: {} },
  savedQueries: Partial<SavedQueriesStubState> = {},
) {
  const payload: ConfigPayload = {
    sources: listing.sources,
    context,
    describe: {
      perSourceSoftLimit: 10000,
      perSourceHardLimit: 100000,
      fromSourcePredicate: 'urn:sparqly:fromSource',
    },
    savedQueries: { writable: true },
  };
  const configStub: Pick<ConfigService, 'list' | 'config' | 'context'> = {
    list: () => of(listing),
    config: () => of(payload),
    context: () => of(payload.context),
  };
  const savedQueriesStub = makeSavedQueriesStub(savedQueries);

  TestBed.configureTestingModule({
    imports: [QueryPage],
    providers: [
      provideRouter([{ path: 'query', component: QueryPage }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ConfigService, useValue: configStub },
      { provide: SavedQueriesService, useValue: savedQueriesStub.service },
    ],
  })
    .overrideComponent(QueryPage, {
      remove: {
        imports: [
          SourcesPickerComponent,
          EditorFrameComponent,
          ResultPaneComponent,
          LibraryComboboxComponent,
        ],
      },
      add: {
        imports: [
          SourcesPickerStub,
          EditorFrameStub,
          ResultPaneStub,
          LibraryComboboxStub,
        ],
      },
    })
    .compileComponents();

  const router = TestBed.inject(Router);
  await router.navigateByUrl(initialUrl);
  const fixture = TestBed.createComponent(QueryPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController);
  return { fixture, router, http, savedQueriesState: savedQueriesStub.state };
}

function editorStub(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): EditorFrameStub {
  const node = fixture.debugElement.query(
    (n) => n.componentInstance instanceof EditorFrameStub,
  );
  if (!node) throw new Error('expected an editor frame stub');
  return node.componentInstance as EditorFrameStub;
}

function libraryStub(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): LibraryComboboxStub {
  const node = fixture.debugElement.query(
    (n) => n.componentInstance instanceof LibraryComboboxStub,
  );
  if (!node) throw new Error('expected a library combobox stub');
  return node.componentInstance as LibraryComboboxStub;
}

function pickerStub(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): SourcesPickerStub {
  const all = Array.from(
    new Set(
      fixture.debugElement
        .queryAll((n) => n.componentInstance instanceof SourcesPickerStub)
        .map((d) => d.componentInstance as SourcesPickerStub),
    ),
  );
  if (all.length !== 1) {
    throw new Error(`expected exactly one picker, got ${all.length}`);
  }
  return all[0];
}

function paneStub(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): ResultPaneStub {
  const all = Array.from(
    new Set(
      fixture.debugElement
        .queryAll((n) => n.componentInstance instanceof ResultPaneStub)
        .map((d) => d.componentInstance as ResultPaneStub),
    ),
  );
  if (all.length !== 1) {
    throw new Error(`expected exactly one result pane, got ${all.length}`);
  }
  return all[0];
}

describe('QueryPage', () => {
  it('renders header, source picker, editor, library combobox and Run button', async () => {
    const { fixture } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('header')).toBeTruthy();
    expect(root.querySelectorAll('app-sources-picker').length).toBe(1);
    expect(root.querySelectorAll('app-library-combobox').length).toBe(1);
    expect(root.querySelectorAll('textarea').length).toBe(1);
    expect(root.querySelector('button[data-testid=run-query]')).toBeTruthy();
    expect(root.querySelector('app-result-pane')).toBeTruthy();
  });

  it('starts with an empty result-pane state before any query has been run', async () => {
    const { fixture } = await setup(TWO);
    expect(paneStub(fixture).state?.kind).toBe('empty');
  });

  it('switches the result-pane state to loading while a request is in flight', async () => {
    const { fixture, http } = await setup(TWO);
    pickerStub(fixture).valueChange.emit('a');
    fixture.detectChanges();
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        'button[data-testid=run-query]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(paneStub(fixture).state?.kind).toBe('loading');
    http.expectOne('/api/sparql/a').flush(
      JSON.stringify({ head: { vars: ['s'] }, results: { bindings: [] } }),
      { headers: { 'Content-Type': 'application/sparql-results+json' } },
    );
    http.verify();
  });

  it('Run posts a SELECT and feeds the decoded result into the result-pane', async () => {
    const { fixture, http } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;

    pickerStub(fixture).valueChange.emit('a');
    const ta = root.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 5';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (root.querySelector('button[data-testid=run-query]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const req = http.expectOne('/api/sparql/a');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBe('SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 5');
    expect(req.request.headers.get('Content-Type')).toBe('application/sparql-query');
    expect(req.request.headers.get('Accept')).toBe('application/sparql-results+json');

    const body = JSON.stringify({ head: { vars: ['s'] }, results: { bindings: [] } });
    req.flush(body, {
      headers: { 'Content-Type': 'application/sparql-results+json' },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const state = paneStub(fixture).state;
    expect(state?.kind).toBe('result');
    if (state?.kind === 'result') {
      expect(state.result.kind).toBe('select');
      expect(state.result.contentType).toBe('application/sparql-results+json');
    }
    http.verify();
  });

  it('Run posts a CONSTRUCT with text/turtle Accept and feeds a triples result into the result-pane', async () => {
    const { fixture, http } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;

    pickerStub(fixture).valueChange.emit('a');
    const ta = root.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o } LIMIT 5';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (root.querySelector('button[data-testid=run-query]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const req = http.expectOne('/api/sparql/a');
    expect(req.request.headers.get('Accept')).toBe('text/turtle');

    const turtle = '<http://example.org/s> <http://example.org/p> <http://example.org/o> .\n';
    req.flush(turtle, { headers: { 'Content-Type': 'text/turtle' } });
    fixture.detectChanges();
    await fixture.whenStable();

    const state = paneStub(fixture).state;
    expect(state?.kind).toBe('result');
    if (state?.kind === 'result') {
      expect(state.result.kind).toBe('triples');
      expect(state.result.contentType).toBe('text/turtle');
    }
    http.verify();
  });

  it('Run with an unrecognised query type sends no Accept header', async () => {
    const { fixture, http } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;

    pickerStub(fixture).valueChange.emit('a');
    const ta = root.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = '   ';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (root.querySelector('button[data-testid=run-query]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const req = http.expectOne('/api/sparql/a');
    expect(req.request.headers.has('Accept')).toBe(false);
    req.flush('', { headers: { 'Content-Type': 'text/plain' } });
    http.verify();
  });

  it('seeds the picked source and query from URL query params', async () => {
    const initialUrl =
      '/query?source=a&query=' +
      encodeURIComponent('SELECT ?s WHERE { ?s ?p ?o }');
    const { fixture } = await setup(TWO, initialUrl);
    const root = fixture.nativeElement as HTMLElement;
    expect(pickerStub(fixture).value).toBe('a');
    const ta = root.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.value).toBe('SELECT ?s WHERE { ?s ?p ?o }');
  });

  it('seeds a default starter query with a classic ?s ?p ?o body when the URL does not provide one', async () => {
    const { fixture } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;
    const ta = root.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.value).toContain('SELECT');
    expect(ta.value).toContain('?s ?p ?o');
  });

  it('seeds the default starter query with a BASE declaration from the config context', async () => {
    const { fixture } = await setup(TWO, '/query', {
      prefixes: {},
      base: 'http://example.org/base/',
    });
    const root = fixture.nativeElement as HTMLElement;
    const ta = root.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.value).toContain('BASE <http://example.org/base/>');
    expect(ta.value).toContain('?s ?p ?o');
  });

  it('seeds the default starter query with PREFIX declarations from the config context', async () => {
    const { fixture } = await setup(TWO, '/query', {
      prefixes: {
        rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
        ex: 'http://example.org/',
      },
    });
    const root = fixture.nativeElement as HTMLElement;
    const ta = root.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.value).toContain(
      'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>',
    );
    expect(ta.value).toContain('PREFIX ex: <http://example.org/>');
    expect(ta.value).toContain('?s ?p ?o');
  });

  it('does not overwrite a URL-supplied query with the default starter', async () => {
    const initialUrl = '/query?source=a&query=' + encodeURIComponent('ASK { ?s ?p ?o }');
    const { fixture } = await setup(TWO, initialUrl);
    const root = fixture.nativeElement as HTMLElement;
    const ta = root.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.value).toBe('ASK { ?s ?p ?o }');
  });

  it('renders an error box and clears prior results when the request fails', async () => {
    const { fixture, http } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;
    pickerStub(fixture).valueChange.emit('a');
    fixture.detectChanges();

    (root.querySelector('button[data-testid=run-query]') as HTMLButtonElement).click();
    fixture.detectChanges();
    http
      .expectOne('/api/sparql/a')
      .flush(JSON.stringify({ message: 'malformed query' }), {
        status: 400,
        statusText: 'Bad Request',
      });
    fixture.detectChanges();
    await fixture.whenStable();

    const state = paneStub(fixture).state;
    expect(state?.kind).toBe('error');
    if (state?.kind === 'error') expect(state.message).toContain('malformed query');
    http.verify();
  });

  it('flows a pinned-address URL `?source=@<id>:<ref>` straight through to the SPARQL endpoint (ADR-0029 bookmark/share, #279)', async () => {
    const initialUrl =
      '/query?source=' +
      encodeURIComponent('@a:v1.2.0') +
      '&query=' +
      encodeURIComponent('ASK { ?s ?p ?o }');
    const { fixture, http, router } = await setup(TWO, initialUrl);
    expect(pickerStub(fixture).value).toBe('@a:v1.2.0');
    const root = fixture.nativeElement as HTMLElement;
    (root.querySelector('button[data-testid=run-query]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const req = http.expectOne(`/api/sparql/${encodeURIComponent('@a:v1.2.0')}`);
    req.flush(
      JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }),
      { headers: { 'Content-Type': 'application/sparql-results+json' } },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    const tree = router.parseUrl(router.url);
    expect(tree.queryParamMap.get('source')).toBe('@a:v1.2.0');
    http.verify();
  });

  it('discards the prior result-pane state when the user picks a different source', async () => {
    const { fixture, http } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;

    pickerStub(fixture).valueChange.emit('a');
    fixture.detectChanges();
    (root.querySelector('button[data-testid=run-query]') as HTMLButtonElement).click();
    fixture.detectChanges();
    http.expectOne('/api/sparql/a').flush(
      JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }),
      { headers: { 'Content-Type': 'application/sparql-results+json' } },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(paneStub(fixture).state?.kind).toBe('result');

    pickerStub(fixture).valueChange.emit('b');
    fixture.detectChanges();

    expect(paneStub(fixture).state?.kind).toBe('empty');
    http.verify();
  });

  describe('saved-query URL contract', () => {
    it('boots from ?savedQuery=<slug>: loads the entry body and reflects the slug on the combobox; source picker untouched', async () => {
      const { fixture, savedQueriesState } = await setup(
        TWO,
        '/query?savedQuery=alpha',
        { prefixes: {} },
        {
          list: [{ slug: 'alpha', hasParameters: false }],
          entries: {
            alpha: {
              entry: { slug: 'alpha', body: 'SELECT ?fromSlug' },
              etag: 'e-alpha',
            },
          },
        },
      );
      expect(savedQueriesState.calls.get).toEqual([{ slug: 'alpha' }]);
      expect(editorStub(fixture).value).toBe('SELECT ?fromSlug');
      expect(libraryStub(fixture).selectedSlug).toBe('alpha');
      // Source picker is whatever default the config provided, not affected by savedQuery.
      expect(pickerStub(fixture).value).toBe('b');
    });

    it('keeps the URL as ?savedQuery=<slug> (no ?query=) while the editor body matches the loaded entry', async () => {
      const { fixture, router } = await setup(
        TWO,
        '/query?savedQuery=alpha',
        { prefixes: {} },
        {
          list: [{ slug: 'alpha', hasParameters: false }],
          entries: {
            alpha: {
              entry: { slug: 'alpha', body: 'SELECT ?loaded' },
              etag: 'e-alpha',
            },
          },
        },
      );
      await fixture.whenStable();
      fixture.detectChanges();
      const tree = router.parseUrl(router.url);
      expect(tree.queryParamMap.get('savedQuery')).toBe('alpha');
      expect(tree.queryParamMap.get('query')).toBeNull();
    });

    it('transitions URL from ?savedQuery=<slug> to ?query=<sparql> when the editor body diverges from the loaded entry', async () => {
      const { fixture, router } = await setup(
        TWO,
        '/query?savedQuery=alpha',
        { prefixes: {} },
        {
          list: [{ slug: 'alpha', hasParameters: false }],
          entries: {
            alpha: {
              entry: { slug: 'alpha', body: 'SELECT ?loaded' },
              etag: 'e-alpha',
            },
          },
        },
      );
      await fixture.whenStable();
      fixture.detectChanges();

      editorStub(fixture).valueChange.emit('SELECT ?edited');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const tree = router.parseUrl(router.url);
      expect(tree.queryParamMap.get('savedQuery')).toBeNull();
      expect(tree.queryParamMap.get('query')).toBe('SELECT ?edited');
    });

    it('does not render a "modified from" affordance on the run surface (ADR-0038)', async () => {
      const { fixture } = await setup(
        TWO,
        '/query?savedQuery=alpha',
        { prefixes: {} },
        {
          list: [{ slug: 'alpha', hasParameters: false }],
          entries: {
            alpha: {
              entry: { slug: 'alpha', body: 'SELECT ?loaded' },
              etag: 'e-alpha',
            },
          },
        },
      );
      await fixture.whenStable();
      fixture.detectChanges();

      editorStub(fixture).valueChange.emit('SELECT ?edited');
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('[data-testid="editor-modified-badge"]')).toBeNull();
    });

    it('when both ?savedQuery= and ?query= are present, ?savedQuery= wins and ?query= is dropped on load', async () => {
      const initialUrl =
        '/query?savedQuery=alpha&query=' +
        encodeURIComponent('SELECT ?ignored');
      const { fixture, router } = await setup(
        TWO,
        initialUrl,
        { prefixes: {} },
        {
          list: [{ slug: 'alpha', hasParameters: false }],
          entries: {
            alpha: {
              entry: { slug: 'alpha', body: 'SELECT ?loaded' },
              etag: 'e-alpha',
            },
          },
        },
      );
      await fixture.whenStable();
      fixture.detectChanges();

      expect(editorStub(fixture).value).toBe('SELECT ?loaded');
      expect(libraryStub(fixture).selectedSlug).toBe('alpha');

      const tree = router.parseUrl(router.url);
      expect(tree.queryParamMap.get('savedQuery')).toBe('alpha');
      expect(tree.queryParamMap.get('query')).toBeNull();
    });

    it('surfaces a not-found error in the editor frame when ?savedQuery=<unknown-slug> cannot be loaded', async () => {
      const { fixture } = await setup(
        TWO,
        '/query?savedQuery=ghost',
        { prefixes: {} },
        { list: [], entries: {} },
      );
      await fixture.whenStable();
      fixture.detectChanges();

      const editor = editorStub(fixture);
      expect(editor.loadError).toEqual({ kind: 'not-found', slug: 'ghost' });
      expect(libraryStub(fixture).selectedSlug).toBeNull();
      const root = fixture.nativeElement as HTMLElement;
      expect(
        root.querySelector('[data-testid="stub-editor-load-error"]'),
      ).toBeTruthy();
    });
  });

  describe('library combobox integration', () => {
    it('renders the library combobox populated from SavedQueriesService.list()', async () => {
      const { fixture, savedQueriesState } = await setup(
        TWO,
        '/query',
        { prefixes: {} },
        { list: [{ slug: 'alpha', hasParameters: false }] },
      );
      expect(savedQueriesState.calls.list).toBe(1);
      expect(libraryStub(fixture).entries.map((e) => e.slug)).toEqual([
        'alpha',
      ]);
    });

    it('loads an entry when the combobox emits load: editor body populates and ?savedQuery= becomes URL state', async () => {
      const { fixture, router, savedQueriesState } = await setup(
        TWO,
        '/query',
        { prefixes: {} },
        {
          list: [{ slug: 'alpha', hasParameters: false }],
          entries: {
            alpha: {
              entry: { slug: 'alpha', body: 'SELECT ?loaded' },
              etag: 'e-alpha',
            },
          },
        },
      );
      libraryStub(fixture).load.emit('alpha');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(savedQueriesState.calls.get).toEqual([{ slug: 'alpha' }]);
      expect(editorStub(fixture).value).toBe('SELECT ?loaded');
      expect(libraryStub(fixture).selectedSlug).toBe('alpha');
      const tree = router.parseUrl(router.url);
      expect(tree.queryParamMap.get('savedQuery')).toBe('alpha');
    });
  });

  describe('templated saved query runtime', () => {
    const TEMPLATE_BODY = 'SELECT * WHERE { ?s ?p ?o ; <urn:c> ?country }';
    const parameters: ParameterDeclaration[] = [
      { name: 'country', type: 'string', cardinality: '1..1' },
    ];

    it("threads the loaded entry's parameters list down to the editor frame", async () => {
      const { fixture } = await setup(
        TWO,
        '/query?savedQuery=byc',
        { prefixes: {} },
        {
          list: [{ slug: 'byc', hasParameters: true }],
          entries: {
            byc: {
              entry: {
                slug: 'byc',
                body: TEMPLATE_BODY,
                parameters,
              },
              etag: 'e-byc',
            },
          },
        },
      );
      const editor = editorStub(fixture);
      expect(editor.parameters).toEqual(parameters);
      expect(editor.value).toBe(TEMPLATE_BODY);
    });

    it('posts the substituted SPARQL to /api/sparql when the parameter form is submitted', async () => {
      const { fixture, http } = await setup(
        TWO,
        '/query?source=a&savedQuery=byc',
        { prefixes: {} },
        {
          list: [{ slug: 'byc', hasParameters: true }],
          entries: {
            byc: {
              entry: {
                slug: 'byc',
                body: TEMPLATE_BODY,
                parameters,
              },
              etag: 'e-byc',
            },
          },
        },
      );
      await fixture.whenStable();
      fixture.detectChanges();

      editorStub(fixture).submitBindings.emit({ country: 'CA' });
      fixture.detectChanges();

      const req = http.expectOne('/api/sparql/a');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toBe(
        'VALUES (?country) { ("CA") }\n' + TEMPLATE_BODY,
      );
      req.flush(
        JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }),
        { headers: { 'Content-Type': 'application/sparql-results+json' } },
      );
      http.verify();
    });
  });

  describe('templated saved query URL bindings', () => {
    const TEMPLATE_BODY = 'SELECT * WHERE { ?s ?p ?o ; <urn:c> ?country }';
    const parameters: ParameterDeclaration[] = [
      { name: 'country', type: 'string', cardinality: '1..1' },
    ];

    it('parses ?bind.<name>=<value> from the URL and threads initialBindings to the editor frame', async () => {
      const { fixture } = await setup(
        TWO,
        '/query?savedQuery=byc&bind.country=CA',
        { prefixes: {} },
        {
          list: [{ slug: 'byc', hasParameters: true }],
          entries: {
            byc: {
              entry: { slug: 'byc', body: TEMPLATE_BODY, parameters },
              etag: 'e-byc',
            },
          },
        },
      );
      await fixture.whenStable();
      fixture.detectChanges();
      expect(editorStub(fixture).initialBindings).toEqual({ country: 'CA' });
    });

    it('history-replaces the URL with ?bind.<name>=<value> on form submit', async () => {
      const { fixture, http, router } = await setup(
        TWO,
        '/query?source=a&savedQuery=byc',
        { prefixes: {} },
        {
          list: [{ slug: 'byc', hasParameters: true }],
          entries: {
            byc: {
              entry: { slug: 'byc', body: TEMPLATE_BODY, parameters },
              etag: 'e-byc',
            },
          },
        },
      );
      await fixture.whenStable();
      fixture.detectChanges();

      editorStub(fixture).submitBindings.emit({ country: 'FR' });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const tree = router.parseUrl(router.url);
      expect(tree.queryParamMap.get('savedQuery')).toBe('byc');
      expect(tree.queryParamMap.get('bind.country')).toBe('FR');
      expect(tree.queryParamMap.get('query')).toBeNull();

      http.expectOne('/api/sparql/a').flush(
        JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }),
        { headers: { 'Content-Type': 'application/sparql-results+json' } },
      );
      http.verify();
    });

    it('drops ?savedQuery= and ?bind.* keys when the editor body diverges from the loaded entry', async () => {
      const { fixture, router } = await setup(
        TWO,
        '/query?savedQuery=byc&bind.country=CA',
        { prefixes: {} },
        {
          list: [{ slug: 'byc', hasParameters: true }],
          entries: {
            byc: {
              entry: { slug: 'byc', body: TEMPLATE_BODY, parameters },
              etag: 'e-byc',
            },
          },
        },
      );
      await fixture.whenStable();
      fixture.detectChanges();

      editorStub(fixture).valueChange.emit('SELECT ?edited');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const tree = router.parseUrl(router.url);
      expect(tree.queryParamMap.get('savedQuery')).toBeNull();
      expect(tree.queryParamMap.get('bind.country')).toBeNull();
      expect(tree.queryParamMap.get('query')).toBe('SELECT ?edited');
    });

    it('emits repeated ?bind.<name>= keys when the submitted binding is an array', async () => {
      const multiParams: ParameterDeclaration[] = [
        { name: 'tag', type: 'string', cardinality: '1..n' },
      ];
      const { fixture, http, router } = await setup(
        TWO,
        '/query?source=a&savedQuery=byc',
        { prefixes: {} },
        {
          list: [{ slug: 'byc', hasParameters: true }],
          entries: {
            byc: {
              entry: {
                slug: 'byc',
                body: TEMPLATE_BODY,
                parameters: multiParams,
              },
              etag: 'e-byc',
            },
          },
        },
      );
      await fixture.whenStable();
      fixture.detectChanges();

      editorStub(fixture).submitBindings.emit({ tag: ['a', 'b'] });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const tree = router.parseUrl(router.url);
      expect(tree.queryParamMap.getAll('bind.tag')).toEqual(['a', 'b']);

      http.expectOne('/api/sparql/a').flush(
        JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }),
        { headers: { 'Content-Type': 'application/sparql-results+json' } },
      );
      http.verify();
    });

    it('accumulates repeated ?bind.<name>= keys into an array for cardinality-n parameters', async () => {
      const multiParams: ParameterDeclaration[] = [
        { name: 'tag', type: 'string', cardinality: '1..n' },
      ];
      const { fixture } = await setup(
        TWO,
        '/query?savedQuery=byc&bind.tag=a&bind.tag=b',
        { prefixes: {} },
        {
          list: [{ slug: 'byc', hasParameters: true }],
          entries: {
            byc: {
              entry: {
                slug: 'byc',
                body: TEMPLATE_BODY,
                parameters: multiParams,
              },
              etag: 'e-byc',
            },
          },
        },
      );
      await fixture.whenStable();
      fixture.detectChanges();
      expect(editorStub(fixture).initialBindings).toEqual({ tag: ['a', 'b'] });
    });
  });

  it('mirrors picked source and editor text into URL query params', async () => {
    const { fixture, router } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;
    pickerStub(fixture).valueChange.emit('a');
    fixture.detectChanges();
    const ta = root.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'SELECT ?s WHERE { ?s ?p ?o }';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    const tree = router.parseUrl(router.url);
    expect(tree.queryParamMap.get('source')).toBe('a');
    expect(tree.queryParamMap.get('query')).toBe(
      'SELECT ?s WHERE { ?s ?p ?o }',
    );
  });
});
