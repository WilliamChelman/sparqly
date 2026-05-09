import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { EditorFrame } from './editor-frame';
import { QueryPage } from './query-page';
import { SourcesPicker } from './sources-picker';
import { YasrViewer } from './yasr-viewer';
import {
  ConfigService,
  type ConfigPayload,
  type DisplayContext,
  type SourceListing,
} from './config.service';

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
  selector: 'app-yasr-viewer',
  standalone: true,
  template: `<div data-testid="stub-yasr" [attr.data-result]="resultJson()"></div>`,
})
class YasrViewerStub {
  @Input() result: unknown = null;
  resultJson(): string {
    return this.result == null ? '' : JSON.stringify(this.result);
  }
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
      remove: { imports: [SourcesPicker, EditorFrame, YasrViewer] },
      add: { imports: [SourcesPickerStub, EditorFrameStub, YasrViewerStub] },
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

function yasrStub(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): YasrViewerStub {
  const all = Array.from(
    new Set(
      fixture.debugElement
        .queryAll((n) => n.componentInstance instanceof YasrViewerStub)
        .map((d) => d.componentInstance as YasrViewerStub),
    ),
  );
  if (all.length !== 1) {
    throw new Error(`expected exactly one yasr viewer, got ${all.length}`);
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
    expect(root.querySelector('app-yasr-viewer')).toBeTruthy();
  });

  it('Run posts a SELECT and forwards the response body and content-type to the YasrViewer', async () => {
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

    expect(yasrStub(fixture).result).toEqual({
      data: body,
      contentType: 'application/sparql-results+json',
      status: 200,
    });
    http.verify();
  });

  it('Run posts a CONSTRUCT with text/turtle Accept and forwards the turtle body to the YasrViewer', async () => {
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

    expect(yasrStub(fixture).result).toEqual({
      data: turtle,
      contentType: 'text/turtle',
      status: 200,
    });
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

    const err = root.querySelector('[data-testid=error]') as HTMLElement | null;
    expect(err).toBeTruthy();
    expect(err?.textContent).toContain('malformed query');
    expect(yasrStub(fixture).result).toBeNull();
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
