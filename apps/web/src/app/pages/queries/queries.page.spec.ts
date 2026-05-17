import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { SavedQuerySummary } from '@app/core';
import { SourcesPickerComponent } from '@app/modules/sources-picker';
import { YasqeEditorComponent } from '@app/modules/yasqe-editor';
import type {
  ParameterBindings,
  ParameterDeclaration,
} from 'common';
import { ParameterEditorComponent } from '../query/components/parameter-editor.component';
import { ParameterFormComponent } from '../query/components/parameter-form.component';
import {
  ResultPaneComponent,
  type ResultPaneState,
} from '../query/components/result/result-pane.component';
import { QueriesPage } from './queries.page';

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
  selector: 'app-result-pane',
  standalone: true,
  template: `<div
    data-testid="stub-result-pane"
    [attr.data-state-kind]="state?.kind ?? ''"
    [attr.data-result-kind]="
      state && state.kind === 'result' ? state.result.kind : ''
    "
    [attr.data-result-content-type]="
      state && state.kind === 'result' ? state.result.contentType : ''
    "
    [attr.data-state-message]="
      state && state.kind === 'error' ? state.message : ''
    "
  ></div>`,
})
class ResultPaneStub {
  @Input() state: ResultPaneState | null = null;
  @Input() context: unknown = { prefixes: {} };
}

@Component({
  selector: 'app-parameter-form',
  standalone: true,
  template: `<form
    data-testid="stub-param-form"
    (submit)="$event.preventDefault(); submitBindings.emit(nextBindings)"
  >
    @for (p of parameters; track p.name) {
      <span [attr.data-testid]="'stub-param-' + p.name"></span>
    }
    <button type="submit" data-testid="stub-param-submit">go</button>
  </form>`,
})
class ParameterFormStub {
  @Input() parameters: ReadonlyArray<ParameterDeclaration> = [];
  @Input() initialBindings: ParameterBindings | undefined;
  @Output() submitBindings = new EventEmitter<ParameterBindings>();
  // Test-only: lets a spec stage what the next submit should emit.
  nextBindings: ParameterBindings = {};
}

@Component({
  selector: 'app-yasqe-editor',
  standalone: true,
  template: `<textarea
    data-testid="stub-yasqe"
    [value]="value"
    (input)="valueChange.emit($any($event.target).value)"
  ></textarea>`,
})
class YasqeEditorStub {
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();
}

@Component({
  selector: 'app-parameter-editor',
  standalone: true,
  template: `<div data-testid="stub-parameter-editor">
    @for (p of parameters; track p.name) {
      <span [attr.data-testid]="'stub-param-decl-' + p.name"></span>
    }
  </div>`,
})
class ParameterEditorStub {
  @Input() parameters: ReadonlyArray<ParameterDeclaration> = [];
  @Input() body = '';
  @Output() parametersChange = new EventEmitter<
    ReadonlyArray<ParameterDeclaration>
  >();
}

const LIBRARY: SavedQuerySummary[] = [
  { slug: 'zebra', hasParameters: false },
  { slug: 'alpha', hasParameters: false },
  { slug: 'beta', description: 'B', hasParameters: false },
];

async function setup(initialUrl = '/queries') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'queries', component: QueriesPage },
        { path: 'queries/:slug', component: QueriesPage },
      ]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  })
    .overrideComponent(QueriesPage, {
      remove: {
        imports: [
          SourcesPickerComponent,
          ResultPaneComponent,
          ParameterFormComponent,
          YasqeEditorComponent,
          ParameterEditorComponent,
        ],
      },
      add: {
        imports: [
          SourcesPickerStub,
          ResultPaneStub,
          ParameterFormStub,
          YasqeEditorStub,
          ParameterEditorStub,
        ],
      },
    })
    .compileComponents();
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(initialUrl, QueriesPage);
  const router = TestBed.inject(Router);
  const http = TestBed.inject(HttpTestingController);
  const fixture = {
    get nativeElement(): HTMLElement {
      return harness.routeNativeElement as HTMLElement;
    },
    get debugElement() {
      return harness.routeDebugElement!;
    },
    detectChanges: () => harness.detectChanges(),
    whenStable: () => harness.fixture.whenStable(),
  };
  return { fixture, harness, router, http };
}

function pickerStub(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): SourcesPickerStub {
  const node = fixture.debugElement.query(
    (n) => n.componentInstance instanceof SourcesPickerStub,
  );
  if (!node) throw new Error('expected a sources picker stub');
  return node.componentInstance as SourcesPickerStub;
}

function paneStub(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): ResultPaneStub {
  const node = fixture.debugElement.query(
    (n) => n.componentInstance instanceof ResultPaneStub,
  );
  if (!node) throw new Error('expected a result pane stub');
  return node.componentInstance as ResultPaneStub;
}

function paramFormStub(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): ParameterFormStub | null {
  const node = fixture.debugElement.query(
    (n) => n.componentInstance instanceof ParameterFormStub,
  );
  return node ? (node.componentInstance as ParameterFormStub) : null;
}

function yasqeStub(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): YasqeEditorStub {
  const node = fixture.debugElement.query(
    (n) => n.componentInstance instanceof YasqeEditorStub,
  );
  if (!node) throw new Error('expected a yasqe editor stub');
  return node.componentInstance as YasqeEditorStub;
}

function parameterEditorStub(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): ParameterEditorStub | null {
  const node = fixture.debugElement.query(
    (n) => n.componentInstance instanceof ParameterEditorStub,
  );
  return node ? (node.componentInstance as ParameterEditorStub) : null;
}

function flushList(
  http: HttpTestingController,
  entries: readonly SavedQuerySummary[] = LIBRARY,
): void {
  const req = http.expectOne('/api/saved-queries');
  expect(req.request.method).toBe('GET');
  req.flush(entries);
}

describe('QueriesPage', () => {
  it('renders all saved-query slugs in the left rail, sorted alphabetically', async () => {
    const { fixture, http } = await setup();
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const slugs = Array.from(
      root.querySelectorAll('[data-testid=queries-entry]'),
    ).map((b) => b.getAttribute('data-slug'));
    expect(slugs).toEqual(['alpha', 'beta', 'zebra']);
    http.verify();
  });

  it('filters the visible list as the user types into the filter input', async () => {
    const { fixture, http } = await setup();
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector(
      '[data-testid=queries-filter]',
    ) as HTMLInputElement;
    input.value = 'bet';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const slugs = Array.from(
      root.querySelectorAll('[data-testid=queries-entry]'),
    ).map((b) => b.getAttribute('data-slug'));
    expect(slugs).toEqual(['beta']);
    http.verify();
  });

  it('navigates to /queries/:slug on selection and renders the body in the right pane', async () => {
    const { fixture, http, router } = await setup();
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const entry = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid=queries-entry]'),
    ).find((b) => b.getAttribute('data-slug') === 'beta') as HTMLButtonElement;
    entry.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(router.url).toBe('/queries/beta');

    // Navigation re-mounts QueriesPage; the new instance fetches the list again
    // before loading the selected slug.
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const req = http.expectOne('/api/saved-queries/beta');
    expect(req.request.method).toBe('GET');
    req.flush(
      { slug: 'beta', body: 'SELECT * WHERE { ?b a :Bee }' },
      { headers: { ETag: '"e-beta"' } },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(yasqeStub(fixture).value).toBe('SELECT * WHERE { ?b a :Bee }');
    http.verify();
  });

  it('auto-selects the entry from /queries/:slug on a fresh boot', async () => {
    const { fixture, http } = await setup('/queries/alpha');
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const req = http.expectOne('/api/saved-queries/alpha');
    req.flush(
      { slug: 'alpha', body: 'ASK { ?s ?p ?o }' },
      { headers: { ETag: '"e-alpha"' } },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const current = root.querySelector(
      '[data-testid=queries-entry][aria-current="true"]',
    );
    expect(current?.getAttribute('data-slug')).toBe('alpha');
    expect(yasqeStub(fixture).value).toBe('ASK { ?s ?p ?o }');
    http.verify();
  });

  it('renders an app-sources-picker and a Run button (Run disabled until a source is picked)', async () => {
    const { fixture, http } = await setup('/queries/alpha');
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    http.expectOne('/api/saved-queries/alpha').flush(
      { slug: 'alpha', body: 'ASK { ?s ?p ?o }' },
      { headers: { ETag: '"e-alpha"' } },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('app-sources-picker')).toBeTruthy();
    const run = root.querySelector(
      '[data-testid=queries-run]',
    ) as HTMLButtonElement | null;
    expect(run).toBeTruthy();
    expect(run!.disabled).toBe(true);

    pickerStub(fixture).valueChange.emit('a');
    fixture.detectChanges();
    expect(run!.disabled).toBe(false);
    http.verify();
  });

  it('writes ?source=@id to the URL when the picker emits a source change', async () => {
    const { fixture, http, router } = await setup('/queries/alpha');
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    http.expectOne('/api/saved-queries/alpha').flush(
      { slug: 'alpha', body: 'ASK { ?s ?p ?o }' },
      { headers: { ETag: '"e-alpha"' } },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    pickerStub(fixture).valueChange.emit('@a');
    fixture.detectChanges();
    await fixture.whenStable();

    const tree = router.parseUrl(router.url);
    expect(tree.queryParamMap.get('source')).toBe('@a');
    http.verify();
  });

  it('restores the picked source from ?source=@id on direct navigation to /queries/:slug', async () => {
    const { fixture, http } = await setup('/queries/alpha?source=@b');
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    http.expectOne('/api/saved-queries/alpha').flush(
      { slug: 'alpha', body: 'ASK { ?s ?p ?o }' },
      { headers: { ETag: '"e-alpha"' } },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(pickerStub(fixture).value).toBe('@b');
    const root = fixture.nativeElement as HTMLElement;
    const run = root.querySelector(
      '[data-testid=queries-run]',
    ) as HTMLButtonElement;
    expect(run.disabled).toBe(false);
    http.verify();
  });

  it('preserves ?source=@id when the user selects a different slug from the rail', async () => {
    const { fixture, http, router } = await setup('/queries/alpha?source=@a');
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    http.expectOne('/api/saved-queries/alpha').flush(
      { slug: 'alpha', body: 'ASK {}' },
      { headers: { ETag: '"e-alpha"' } },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const beta = Array.from(
      root.querySelectorAll('[data-testid=queries-entry]'),
    ).find((b) => b.getAttribute('data-slug') === 'beta') as HTMLButtonElement;
    beta.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const tree = router.parseUrl(router.url);
    expect(tree.queryParamMap.get('source')).toBe('@a');
    http.verify();
  });

  it('Run posts the loaded literal body to /api/sparql/<source> and feeds the result into app-result-pane', async () => {
    const { fixture, http } = await setup('/queries/alpha?source=@a');
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    http.expectOne('/api/saved-queries/alpha').flush(
      { slug: 'alpha', body: 'SELECT ?s WHERE { ?s ?p ?o }' },
      { headers: { ETag: '"e-alpha"' } },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const run = root.querySelector(
      '[data-testid=queries-run]',
    ) as HTMLButtonElement;
    run.click();
    fixture.detectChanges();

    expect(paneStub(fixture).state?.kind).toBe('loading');

    const req = http.expectOne(`/api/sparql/${encodeURIComponent('@a')}`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBe('SELECT ?s WHERE { ?s ?p ?o }');
    expect(req.request.headers.get('Content-Type')).toBe(
      'application/sparql-query',
    );
    expect(req.request.headers.get('Accept')).toBe(
      'application/sparql-results+json',
    );
    req.flush(
      JSON.stringify({ head: { vars: ['s'] }, results: { bindings: [] } }),
      { headers: { 'Content-Type': 'application/sparql-results+json' } },
    );
    fixture.detectChanges();
    await fixture.whenStable();

    const state = paneStub(fixture).state;
    expect(state?.kind).toBe('result');
    if (state?.kind === 'result') {
      expect(state.result.kind).toBe('select');
    }
    http.verify();
  });

  it('does not render the parameter form when the loaded entry is a literal saved query', async () => {
    const { fixture, http } = await setup('/queries/alpha');
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    http.expectOne('/api/saved-queries/alpha').flush(
      { slug: 'alpha', body: 'ASK {}' },
      { headers: { ETag: '"e-alpha"' } },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(paramFormStub(fixture)).toBeNull();
    http.verify();
  });

  it('renders the parameter form when the loaded entry has a non-empty parameters list', async () => {
    const { fixture, http } = await setup('/queries/beta?source=@a');
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    http.expectOne('/api/saved-queries/beta').flush(
      {
        slug: 'beta',
        body: 'SELECT ?b WHERE { ?b a ?cls }',
        parameters: [
          {
            name: 'cls',
            type: 'iri',
            cardinality: '1..1',
          } satisfies ParameterDeclaration,
        ],
      },
      { headers: { ETag: '"e-beta"' } },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const form = paramFormStub(fixture);
    expect(form).toBeTruthy();
    expect(form!.parameters).toEqual([
      { name: 'cls', type: 'iri', cardinality: '1..1' },
    ]);
    http.verify();
  });

  it('substitutes bindings client-side and POSTs the prepended VALUES + body when the parameter form submits', async () => {
    const { fixture, http } = await setup('/queries/beta?source=@a');
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    http.expectOne('/api/saved-queries/beta').flush(
      {
        slug: 'beta',
        body: 'SELECT ?b WHERE { ?b a ?cls }',
        parameters: [
          {
            name: 'cls',
            type: 'iri',
            cardinality: '1..1',
          } satisfies ParameterDeclaration,
        ],
      },
      { headers: { ETag: '"e-beta"' } },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const form = paramFormStub(fixture);
    expect(form).toBeTruthy();
    form!.submitBindings.emit({
      cls: 'http://example.org/Bee',
    } satisfies ParameterBindings);
    fixture.detectChanges();

    const req = http.expectOne(`/api/sparql/${encodeURIComponent('@a')}`);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Content-Type')).toBe(
      'application/sparql-query',
    );
    const body = req.request.body as string;
    expect(body).toContain('VALUES');
    expect(body).toContain('?cls');
    expect(body).toContain('<http://example.org/Bee>');
    expect(body).toContain('SELECT ?b WHERE { ?b a ?cls }');
    req.flush(
      JSON.stringify({ head: { vars: ['b'] }, results: { bindings: [] } }),
      { headers: { 'Content-Type': 'application/sparql-results+json' } },
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(paneStub(fixture).state?.kind).toBe('result');
    http.verify();
  });

  it('renders an inline not-found state in the right pane for an unknown slug', async () => {
    const { fixture, http } = await setup('/queries/ghost');
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const notFound = root.querySelector('[data-testid=queries-detail-not-found]');
    expect(notFound).toBeTruthy();
    expect(notFound?.textContent).toContain('ghost');
    expect(root.querySelector('[data-testid=stub-yasqe]')).toBeFalsy();
    // No GET for the entry should be issued when the slug isn't in the list.
    http.expectNone('/api/saved-queries/ghost');
    http.verify();
  });

  describe('authoring surface — Save', () => {
    async function setupLoaded(
      slug = 'alpha',
      entry: {
        body: string;
        parameters?: ReadonlyArray<ParameterDeclaration>;
      } = { body: 'SELECT * WHERE { ?s ?p ?o }' },
      etag = 'e1',
    ) {
      const ctx = await setup(`/queries/${slug}`);
      flushList(ctx.http);
      ctx.fixture.detectChanges();
      await ctx.fixture.whenStable();
      ctx.fixture.detectChanges();
      ctx.http
        .expectOne(`/api/saved-queries/${slug}`)
        .flush(
          { slug, ...entry },
          { headers: { ETag: `"${etag}"` } },
        );
      ctx.fixture.detectChanges();
      await ctx.fixture.whenStable();
      ctx.fixture.detectChanges();
      return ctx;
    }

    it('does not render a Save button before an entry is loaded', async () => {
      const { fixture, http } = await setup('/queries');
      flushList(http);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('[data-testid=queries-save]')).toBeNull();
      http.verify();
    });

    it('renders a Save button when an entry is loaded', async () => {
      const { fixture, http } = await setupLoaded();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('[data-testid=queries-save]')).toBeTruthy();
      http.verify();
    });

    it('Save PUTs /api/saved-queries/:slug with If-Match of the stored ETag, then stores the new ETag for a subsequent save', async () => {
      const { fixture, http } = await setupLoaded(
        'alpha',
        { body: 'SELECT ?orig' },
        'e1',
      );

      yasqeStub(fixture).valueChange.emit('SELECT ?edited');
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;
      (root.querySelector('[data-testid=queries-save]') as HTMLButtonElement)
        .click();
      fixture.detectChanges();

      const put = http.expectOne('/api/saved-queries/alpha');
      expect(put.request.method).toBe('PUT');
      expect(put.request.headers.get('If-Match')).toBe('"e1"');
      expect(put.request.body).toEqual({ body: 'SELECT ?edited' });
      put.flush({ slug: 'alpha', body: 'SELECT ?edited' }, {
        headers: { ETag: '"e2"' },
      });
      fixture.detectChanges();
      await fixture.whenStable();
      // Save also refreshes the left rail.
      flushList(http);
      fixture.detectChanges();

      // A subsequent Save uses the new ETag.
      yasqeStub(fixture).valueChange.emit('SELECT ?edited2');
      fixture.detectChanges();
      (root.querySelector('[data-testid=queries-save]') as HTMLButtonElement)
        .click();
      fixture.detectChanges();

      const put2 = http.expectOne('/api/saved-queries/alpha');
      expect(put2.request.headers.get('If-Match')).toBe('"e2"');
      put2.flush({ slug: 'alpha', body: 'SELECT ?edited2' }, {
        headers: { ETag: '"e3"' },
      });
      fixture.detectChanges();
      await fixture.whenStable();
      flushList(http);
      http.verify();
    });

    it('after a successful Save, re-fetches the saved-queries list to refresh the left rail', async () => {
      const { fixture, http } = await setupLoaded(
        'alpha',
        { body: 'SELECT ?orig' },
        'e1',
      );
      yasqeStub(fixture).valueChange.emit('SELECT ?edited');
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      (root.querySelector('[data-testid=queries-save]') as HTMLButtonElement)
        .click();
      fixture.detectChanges();
      http
        .expectOne('/api/saved-queries/alpha')
        .flush(
          { slug: 'alpha', body: 'SELECT ?edited' },
          { headers: { ETag: '"e2"' } },
        );
      fixture.detectChanges();
      await fixture.whenStable();

      const listReq = http.expectOne('/api/saved-queries');
      expect(listReq.request.method).toBe('GET');
      listReq.flush([
        { slug: 'alpha', hasParameters: false },
        { slug: 'beta', description: 'B', hasParameters: false },
      ]);
      fixture.detectChanges();
      http.verify();
    });

    it('renders app-parameter-editor below the body for a loaded entry and includes the parameter-declarations draft in the PUT body', async () => {
      const { fixture, http } = await setupLoaded(
        'alpha',
        { body: 'SELECT ?country' },
        'e1',
      );

      const editor = parameterEditorStub(fixture);
      expect(editor).toBeTruthy();

      const edited: ParameterDeclaration[] = [
        { name: 'country', type: 'string', cardinality: '1..1' },
      ];
      editor!.parametersChange.emit(edited);
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;
      (root.querySelector('[data-testid=queries-save]') as HTMLButtonElement)
        .click();
      fixture.detectChanges();

      const put = http.expectOne('/api/saved-queries/alpha');
      expect(put.request.body).toEqual({
        body: 'SELECT ?country',
        parameters: edited,
      });
      put.flush(
        { slug: 'alpha', body: 'SELECT ?country', parameters: edited },
        { headers: { ETag: '"e2"' } },
      );
      fixture.detectChanges();
      await fixture.whenStable();
      flushList(http);
      http.verify();
    });

    it('omits parameters from the PUT body when the parameter-declarations draft is empty', async () => {
      const { fixture, http } = await setupLoaded(
        'alpha',
        { body: 'SELECT *' },
        'e1',
      );
      parameterEditorStub(fixture)!.parametersChange.emit([]);
      fixture.detectChanges();
      yasqeStub(fixture).valueChange.emit('SELECT ?x');
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      (root.querySelector('[data-testid=queries-save]') as HTMLButtonElement)
        .click();
      fixture.detectChanges();
      const put = http.expectOne('/api/saved-queries/alpha');
      expect(put.request.body).toEqual({ body: 'SELECT ?x' });
      expect(put.request.body).not.toHaveProperty('parameters');
      put.flush(
        { slug: 'alpha', body: 'SELECT ?x' },
        { headers: { ETag: '"e2"' } },
      );
      fixture.detectChanges();
      await fixture.whenStable();
      flushList(http);
      http.verify();
    });

    it('shows "modified from <slug>" when the body diverges from the loaded entry; hides it before any edit and after a successful save', async () => {
      const { fixture, http } = await setupLoaded(
        'alpha',
        { body: 'SELECT ?orig' },
        'e1',
      );
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('[data-testid=queries-modified-badge]')).toBeNull();

      yasqeStub(fixture).valueChange.emit('SELECT ?edited');
      fixture.detectChanges();
      const badge = root.querySelector(
        '[data-testid=queries-modified-badge]',
      ) as HTMLElement | null;
      expect(badge).toBeTruthy();
      expect(badge?.textContent ?? '').toContain('alpha');

      (root.querySelector('[data-testid=queries-save]') as HTMLButtonElement)
        .click();
      fixture.detectChanges();
      http
        .expectOne('/api/saved-queries/alpha')
        .flush(
          { slug: 'alpha', body: 'SELECT ?edited' },
          { headers: { ETag: '"e2"' } },
        );
      fixture.detectChanges();
      await fixture.whenStable();
      flushList(http);
      fixture.detectChanges();

      expect(
        root.querySelector('[data-testid=queries-modified-badge]'),
      ).toBeNull();
      http.verify();
    });

    it('surfaces "modified from <slug>" when parameter declarations diverge from the loaded entry', async () => {
      const { fixture, http } = await setupLoaded(
        'alpha',
        { body: 'SELECT ?country' },
        'e1',
      );
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('[data-testid=queries-modified-badge]')).toBeNull();

      parameterEditorStub(fixture)!.parametersChange.emit([
        { name: 'country', type: 'string', cardinality: '1..1' },
      ]);
      fixture.detectChanges();

      expect(
        root.querySelector('[data-testid=queries-modified-badge]'),
      ).toBeTruthy();
      http.verify();
    });

    it('on 412 from Save, renders the stale-conflict dialog with Reload and Overwrite buttons', async () => {
      const { fixture, http } = await setupLoaded(
        'alpha',
        { body: 'SELECT ?orig' },
        'e1',
      );
      yasqeStub(fixture).valueChange.emit('SELECT ?edited');
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      (root.querySelector('[data-testid=queries-save]') as HTMLButtonElement)
        .click();
      fixture.detectChanges();
      http
        .expectOne('/api/saved-queries/alpha')
        .flush(
          { message: 'stale' },
          { status: 412, statusText: 'Precondition Failed' },
        );
      fixture.detectChanges();
      await fixture.whenStable();

      const dialog = root.querySelector('[data-testid=queries-stale-dialog]');
      expect(dialog).toBeTruthy();
      expect(
        dialog?.querySelector('[data-testid=queries-stale-reload]'),
      ).toBeTruthy();
      expect(
        dialog?.querySelector('[data-testid=queries-stale-overwrite]'),
      ).toBeTruthy();
      http.verify();
    });

    it('Reload in the stale dialog re-fetches the entry, replaces local edits with the server body, and closes the dialog', async () => {
      const { fixture, http } = await setupLoaded(
        'alpha',
        { body: 'SELECT ?orig' },
        'e1',
      );
      yasqeStub(fixture).valueChange.emit('SELECT ?edited');
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      (root.querySelector('[data-testid=queries-save]') as HTMLButtonElement)
        .click();
      fixture.detectChanges();
      http
        .expectOne('/api/saved-queries/alpha')
        .flush({ message: 'stale' }, { status: 412, statusText: '' });
      fixture.detectChanges();
      await fixture.whenStable();

      (
        root.querySelector(
          '[data-testid=queries-stale-reload]',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      http
        .expectOne('/api/saved-queries/alpha')
        .flush(
          { slug: 'alpha', body: 'SELECT ?serverNew' },
          { headers: { ETag: '"e2"' } },
        );
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(yasqeStub(fixture).value).toBe('SELECT ?serverNew');
      expect(
        root.querySelector('[data-testid=queries-stale-dialog]'),
      ).toBeNull();
      http.verify();
    });

    it('Overwrite in the stale dialog re-fetches the new ETag and re-PUTs with the user body and that ETag', async () => {
      const { fixture, http } = await setupLoaded(
        'alpha',
        { body: 'SELECT ?orig' },
        'e1',
      );
      yasqeStub(fixture).valueChange.emit('SELECT ?edited');
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      (root.querySelector('[data-testid=queries-save]') as HTMLButtonElement)
        .click();
      fixture.detectChanges();
      http
        .expectOne('/api/saved-queries/alpha')
        .flush({ message: 'stale' }, { status: 412, statusText: '' });
      fixture.detectChanges();
      await fixture.whenStable();

      (
        root.querySelector(
          '[data-testid=queries-stale-overwrite]',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      // Overwrite first re-fetches to get the new ETag…
      http
        .expectOne('/api/saved-queries/alpha')
        .flush(
          { slug: 'alpha', body: 'SELECT ?serverNew' },
          { headers: { ETag: '"e2"' } },
        );
      fixture.detectChanges();
      await fixture.whenStable();

      // …then PUTs with the user's body and the fresh ETag.
      const put = http.expectOne('/api/saved-queries/alpha');
      expect(put.request.method).toBe('PUT');
      expect(put.request.headers.get('If-Match')).toBe('"e2"');
      expect(put.request.body).toEqual({ body: 'SELECT ?edited' });
      put.flush(
        { slug: 'alpha', body: 'SELECT ?edited' },
        { headers: { ETag: '"e3"' } },
      );
      fixture.detectChanges();
      await fixture.whenStable();
      flushList(http);

      expect(
        root.querySelector('[data-testid=queries-stale-dialog]'),
      ).toBeNull();
      http.verify();
    });
  });
});
