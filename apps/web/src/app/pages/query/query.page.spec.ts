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
  type ConfigPayload,
  type DisplayContext,
  type SourceListing,
} from '@app/core';

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
  ></textarea>`,
})
class EditorFrameStub {
  @Input() value = '';
  @Input() name = 'query';
  @Output() valueChange = new EventEmitter<string>();
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

async function setup(
  listing: SourceListing,
  initialUrl = '/query',
  context: DisplayContext = { prefixes: {} },
) {
  const payload: ConfigPayload = {
    sources: listing.sources,
    context,
    describe: {
      perSourceSoftLimit: 10000,
      perSourceHardLimit: 100000,
      fromSourcePredicate: 'urn:sparqly:fromSource',
    },
  };
  const configStub: Pick<ConfigService, 'list' | 'config' | 'context'> = {
    list: () => of(listing),
    config: () => of(payload),
    context: () => of(payload.context),
  };

  TestBed.configureTestingModule({
    imports: [QueryPage],
    providers: [
      provideRouter([{ path: 'query', component: QueryPage }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ConfigService, useValue: configStub },
    ],
  })
    .overrideComponent(QueryPage, {
      remove: {
        imports: [
          SourcesPickerComponent,
          EditorFrameComponent,
          ResultPaneComponent,
        ],
      },
      add: { imports: [SourcesPickerStub, EditorFrameStub, ResultPaneStub] },
    })
    .compileComponents();

  const router = TestBed.inject(Router);
  await router.navigateByUrl(initialUrl);
  const fixture = TestBed.createComponent(QueryPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController);
  return { fixture, router, http };
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
