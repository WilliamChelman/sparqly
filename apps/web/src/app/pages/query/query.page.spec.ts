import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
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
  type DeleteResult,
  type DisplayContext,
  type LoadedSavedQuery,
  type PutResult,
  type SavedQueryEntry,
  type SavedQuerySummary,
  type SavedQueryWriteBody,
  type SourceListing,
} from '@app/core';
import { LibraryPickerComponent } from '@app/modules/library-picker';

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
    @if (isModifiedFromLoaded()) {
      <span data-testid="stub-editor-badge"
        >modified from {{ loadedSlug }}</span
      >
    }`,
})
class EditorFrameStub {
  @Input() value = '';
  @Input() name = 'query';
  @Input() loadedSlug?: string;
  @Input() loadedBody?: string;
  @Input() writable = true;
  @Output() valueChange = new EventEmitter<string>();
  @Output() save = new EventEmitter<void>();
  @Output() saveAs = new EventEmitter<void>();
  @Output() delete = new EventEmitter<void>();
  isModifiedFromLoaded(): boolean {
    return (
      this.loadedSlug !== undefined &&
      this.loadedBody !== undefined &&
      this.value !== this.loadedBody
    );
  }
}

@Component({
  selector: 'app-library-picker',
  standalone: true,
  template: `<ul data-testid="stub-library">
    @for (e of entries; track e.slug) {
      <li data-testid="stub-library-entry">{{ e.slug }}</li>
    }
  </ul>`,
})
class LibraryPickerStub {
  @Input() entries: readonly SavedQuerySummary[] = [];
  @Input() writable = true;
  // eslint-disable-next-line @angular-eslint/no-output-native
  @Output() load = new EventEmitter<string>();
  @Output() delete = new EventEmitter<string>();
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
  putBehavior?: (
    slug: string,
    body: SavedQueryWriteBody,
    ifMatch?: string,
  ) => PutResult;
  deleteBehavior?: (slug: string, ifMatch: string) => DeleteResult;
  calls: {
    list: number;
    get: Array<{ slug: string }>;
    put: Array<{ slug: string; body: SavedQueryWriteBody; ifMatch?: string }>;
    delete: Array<{ slug: string; ifMatch: string }>;
  };
}

function makeSavedQueriesStub(
  initial: Partial<SavedQueriesStubState> = {},
): {
  state: SavedQueriesStubState;
  service: Pick<SavedQueriesService, 'list' | 'get' | 'put' | 'delete'>;
} {
  const state: SavedQueriesStubState = {
    list: initial.list ?? [],
    entries: initial.entries ?? {},
    putBehavior: initial.putBehavior,
    deleteBehavior: initial.deleteBehavior,
    calls: { list: 0, get: [], put: [], delete: [] },
  };
  const service: Pick<SavedQueriesService, 'list' | 'get' | 'put' | 'delete'> =
    {
      list: () => {
        state.calls.list += 1;
        return of(state.list as readonly SavedQuerySummary[]);
      },
      get: (slug: string) => {
        state.calls.get.push({ slug });
        const found = state.entries[slug];
        if (!found) throw new Error(`stub: unknown slug ${slug}`);
        return of<LoadedSavedQuery>({ entry: found.entry, etag: found.etag });
      },
      put: (slug: string, body: SavedQueryWriteBody, ifMatch?: string) => {
        state.calls.put.push({ slug, body, ifMatch });
        const result: PutResult = state.putBehavior
          ? state.putBehavior(slug, body, ifMatch)
          : { kind: 'saved', etag: `etag-${slug}-${state.calls.put.length}` };
        if (result.kind === 'saved') {
          state.entries[slug] = {
            entry: { slug, body: body.body, description: body.description },
            etag: result.etag,
          };
          if (!state.list.some((e) => e.slug === slug)) {
            state.list = [...state.list, { slug, hasParameters: false }];
          }
        }
        return of(result);
      },
      delete: (slug: string, ifMatch: string) => {
        state.calls.delete.push({ slug, ifMatch });
        const result: DeleteResult = state.deleteBehavior
          ? state.deleteBehavior(slug, ifMatch)
          : { kind: 'deleted' };
        if (result.kind === 'deleted') {
          delete state.entries[slug];
          state.list = state.list.filter((e) => e.slug !== slug);
        }
        return of(result);
      },
    };
  return { state, service };
}

async function setup(
  listing: SourceListing,
  initialUrl = '/query',
  context: DisplayContext = { prefixes: {} },
  savedQueries: Partial<SavedQueriesStubState> = {},
  capabilities: { writable?: boolean } = {},
) {
  const payload: ConfigPayload = {
    sources: listing.sources,
    context,
    describe: {
      perSourceSoftLimit: 10000,
      perSourceHardLimit: 100000,
      fromSourcePredicate: 'urn:sparqly:fromSource',
    },
    savedQueries: { writable: capabilities.writable ?? true },
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
          LibraryPickerComponent,
        ],
      },
      add: {
        imports: [
          SourcesPickerStub,
          EditorFrameStub,
          ResultPaneStub,
          LibraryPickerStub,
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
}): LibraryPickerStub {
  const node = fixture.debugElement.query(
    (n) => n.componentInstance instanceof LibraryPickerStub,
  );
  if (!node) throw new Error('expected a library picker stub');
  return node.componentInstance as LibraryPickerStub;
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
  it('renders header, source picker, editor, and Run button', async () => {
    const { fixture } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('header')).toBeTruthy();
    expect(root.querySelectorAll('app-sources-picker').length).toBe(1);
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

  describe('read-only capability', () => {
    it('threads writable=true from /api/config to the editor and library picker by default', async () => {
      const { fixture } = await setup(TWO);
      expect(editorStub(fixture).writable).toBe(true);
      expect(libraryStub(fixture).writable).toBe(true);
    });

    it('threads writable=false from /api/config to the editor and library picker', async () => {
      const { fixture } = await setup(TWO, '/query', { prefixes: {} }, {}, {
        writable: false,
      });
      expect(editorStub(fixture).writable).toBe(false);
      expect(libraryStub(fixture).writable).toBe(false);
    });
  });

  describe('saved-queries integration', () => {
    it('renders the library picker populated from SavedQueriesService.list()', async () => {
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

    it('loads an entry on library load: editor body populates from the entry and slug is tracked', async () => {
      const { fixture, savedQueriesState } = await setup(
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
      expect(savedQueriesState.calls.get).toEqual([{ slug: 'alpha' }]);
      const editor = editorStub(fixture);
      expect(editor.value).toBe('SELECT ?loaded');
      expect(editor.loadedSlug).toBe('alpha');
      expect(editor.loadedBody).toBe('SELECT ?loaded');
    });

    it('after loading, Save PUTs with If-Match of the stored ETag and stores the new ETag', async () => {
      const { fixture, savedQueriesState } = await setup(
        TWO,
        '/query',
        { prefixes: {} },
        {
          list: [{ slug: 'alpha', hasParameters: false }],
          entries: {
            alpha: {
              entry: { slug: 'alpha', body: 'SELECT ?loaded' },
              etag: 'e1',
            },
          },
        },
      );
      libraryStub(fixture).load.emit('alpha');
      fixture.detectChanges();

      const editor = editorStub(fixture);
      editor.valueChange.emit('SELECT ?edited');
      fixture.detectChanges();

      editor.save.emit();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(savedQueriesState.calls.put).toEqual([
        { slug: 'alpha', body: { body: 'SELECT ?edited' }, ifMatch: 'e1' },
      ]);
      // After save, the editor's loadedBody now equals the saved value (no badge).
      expect(editorStub(fixture).loadedBody).toBe('SELECT ?edited');
    });

    it('shows "modified from <slug>" once the editor body diverges from the loaded entry', async () => {
      const { fixture } = await setup(
        TWO,
        '/query',
        { prefixes: {} },
        {
          list: [{ slug: 'alpha', hasParameters: false }],
          entries: {
            alpha: {
              entry: { slug: 'alpha', body: 'SELECT ?loaded' },
              etag: 'e1',
            },
          },
        },
      );
      libraryStub(fixture).load.emit('alpha');
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('[data-testid="stub-editor-badge"]')).toBeNull();

      editorStub(fixture).valueChange.emit('SELECT ?edited');
      fixture.detectChanges();
      const badge = root.querySelector(
        '[data-testid="stub-editor-badge"]',
      ) as HTMLElement | null;
      expect(badge).toBeTruthy();
      expect(badge?.textContent ?? '').toContain('alpha');
    });

    it('Save-as opens an inline dialog; submitting PUTs without If-Match and the new entry appears in the library', async () => {
      const { fixture, savedQueriesState } = await setup(
        TWO,
        '/query',
        { prefixes: {} },
        { list: [{ slug: 'alpha', hasParameters: false }] },
      );
      const editor = editorStub(fixture);
      editor.valueChange.emit('SELECT ?body');
      fixture.detectChanges();

      editor.saveAs.emit();
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;
      const dialog = root.querySelector(
        '[data-testid="save-as-dialog"]',
      ) as HTMLElement | null;
      expect(dialog).toBeTruthy();

      const slugInput = dialog!.querySelector(
        '[data-testid="save-as-slug"]',
      ) as HTMLInputElement;
      slugInput.value = 'beta';
      slugInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      (
        dialog!.querySelector(
          '[data-testid="save-as-submit"]',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(savedQueriesState.calls.put).toEqual([
        { slug: 'beta', body: { body: 'SELECT ?body' }, ifMatch: undefined },
      ]);
      expect(libraryStub(fixture).entries.map((e) => e.slug).sort()).toEqual([
        'alpha',
        'beta',
      ]);
      expect(root.querySelector('[data-testid="save-as-dialog"]')).toBeNull();
    });

    it('Save-as on a colliding slug surfaces an inline slug-collision error in the dialog', async () => {
      const { fixture } = await setup(
        TWO,
        '/query',
        { prefixes: {} },
        {
          list: [{ slug: 'alpha', hasParameters: false }],
          putBehavior: () => ({ kind: 'slug-exists' }),
        },
      );
      editorStub(fixture).valueChange.emit('SELECT ?body');
      fixture.detectChanges();
      editorStub(fixture).saveAs.emit();
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;
      const dialog = root.querySelector(
        '[data-testid="save-as-dialog"]',
      ) as HTMLElement;
      const slugInput = dialog.querySelector(
        '[data-testid="save-as-slug"]',
      ) as HTMLInputElement;
      slugInput.value = 'alpha';
      slugInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      (
        dialog.querySelector(
          '[data-testid="save-as-submit"]',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      await fixture.whenStable();

      // Dialog stays open with an inline collision error.
      expect(
        root.querySelector('[data-testid="save-as-dialog"]'),
      ).toBeTruthy();
      const err = root.querySelector(
        '[data-testid="save-as-collision"]',
      ) as HTMLElement | null;
      expect(err).toBeTruthy();
      expect(err?.textContent ?? '').toMatch(/already exists|slug/i);
    });

    it('on 412 from Save, surfaces a reload-or-overwrite dialog', async () => {
      const { fixture } = await setup(
        TWO,
        '/query',
        { prefixes: {} },
        {
          list: [{ slug: 'alpha', hasParameters: false }],
          entries: {
            alpha: {
              entry: { slug: 'alpha', body: 'SELECT ?loaded' },
              etag: 'e1',
            },
          },
          putBehavior: () => ({ kind: 'stale' }),
        },
      );
      libraryStub(fixture).load.emit('alpha');
      fixture.detectChanges();

      editorStub(fixture).valueChange.emit('SELECT ?edited');
      fixture.detectChanges();
      editorStub(fixture).save.emit();
      fixture.detectChanges();
      await fixture.whenStable();

      const root = fixture.nativeElement as HTMLElement;
      const dialog = root.querySelector('[data-testid="stale-dialog"]');
      expect(dialog).toBeTruthy();
      expect(
        dialog?.querySelector('[data-testid="stale-reload"]'),
      ).toBeTruthy();
      expect(
        dialog?.querySelector('[data-testid="stale-overwrite"]'),
      ).toBeTruthy();
    });

    it('reload in the stale dialog re-fetches the entry and replaces the editor body', async () => {
      const { fixture, savedQueriesState } = await setup(
        TWO,
        '/query',
        { prefixes: {} },
        {
          list: [{ slug: 'alpha', hasParameters: false }],
          entries: {
            alpha: {
              entry: { slug: 'alpha', body: 'SELECT ?original' },
              etag: 'e1',
            },
          },
          putBehavior: () => ({ kind: 'stale' }),
        },
      );
      libraryStub(fixture).load.emit('alpha');
      fixture.detectChanges();

      // External update: bump server-side content + etag
      savedQueriesState.entries['alpha'] = {
        entry: { slug: 'alpha', body: 'SELECT ?serverNew' },
        etag: 'e2',
      };

      editorStub(fixture).valueChange.emit('SELECT ?edited');
      fixture.detectChanges();
      editorStub(fixture).save.emit();
      fixture.detectChanges();
      await fixture.whenStable();

      const root = fixture.nativeElement as HTMLElement;
      (
        root.querySelector('[data-testid="stale-reload"]') as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      await fixture.whenStable();

      const editor = editorStub(fixture);
      expect(editor.value).toBe('SELECT ?serverNew');
      expect(editor.loadedBody).toBe('SELECT ?serverNew');
      expect(root.querySelector('[data-testid="stale-dialog"]')).toBeNull();
    });

    it('overwrite in the stale dialog re-fetches the etag and re-PUTs with the user\'s body', async () => {
      // First PUT returns stale; second PUT succeeds.
      let putCount = 0;
      const { fixture, savedQueriesState } = await setup(
        TWO,
        '/query',
        { prefixes: {} },
        {
          list: [{ slug: 'alpha', hasParameters: false }],
          entries: {
            alpha: {
              entry: { slug: 'alpha', body: 'SELECT ?original' },
              etag: 'e1',
            },
          },
          putBehavior: () => {
            putCount += 1;
            return putCount === 1
              ? { kind: 'stale' }
              : { kind: 'saved', etag: 'e3' };
          },
        },
      );
      libraryStub(fixture).load.emit('alpha');
      fixture.detectChanges();

      // External update bumps server etag to e2
      savedQueriesState.entries['alpha'] = {
        entry: { slug: 'alpha', body: 'SELECT ?serverNew' },
        etag: 'e2',
      };

      editorStub(fixture).valueChange.emit('SELECT ?edited');
      fixture.detectChanges();
      editorStub(fixture).save.emit();
      fixture.detectChanges();
      await fixture.whenStable();

      const root = fixture.nativeElement as HTMLElement;
      (
        root.querySelector(
          '[data-testid="stale-overwrite"]',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      await fixture.whenStable();

      const calls = savedQueriesState.calls.put;
      expect(calls.length).toBe(2);
      expect(calls[0]).toEqual({
        slug: 'alpha',
        body: { body: 'SELECT ?edited' },
        ifMatch: 'e1',
      });
      expect(calls[1]).toEqual({
        slug: 'alpha',
        body: { body: 'SELECT ?edited' },
        ifMatch: 'e2',
      });
      expect(root.querySelector('[data-testid="stale-dialog"]')).toBeNull();
    });

    it('Delete from EditorFrame issues DELETE with the stored ETag and clears the loaded slug', async () => {
      const { fixture, savedQueriesState } = await setup(
        TWO,
        '/query',
        { prefixes: {} },
        {
          list: [{ slug: 'alpha', hasParameters: false }],
          entries: {
            alpha: {
              entry: { slug: 'alpha', body: 'SELECT ?loaded' },
              etag: 'e1',
            },
          },
        },
      );
      libraryStub(fixture).load.emit('alpha');
      fixture.detectChanges();

      editorStub(fixture).delete.emit();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(savedQueriesState.calls.delete).toEqual([
        { slug: 'alpha', ifMatch: 'e1' },
      ]);
      expect(editorStub(fixture).loadedSlug).toBeUndefined();
      expect(libraryStub(fixture).entries.map((e) => e.slug)).toEqual([]);
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
