import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
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
import type { ParameterBindings, ParameterDeclaration } from 'common';
import { QueryPage } from './query.page';

const TWO: SourceListing = {
  sources: [
    { id: 'a', kind: 'glob', mode: 'in-memory', label: 'A (glob)' },
    { id: 'b', kind: 'glob', mode: 'in-memory', label: 'B (glob)', default: true },
  ],
};

interface SavedQueriesStubState {
  list: SavedQuerySummary[];
  entries: Record<string, { entry: SavedQueryEntry; etag: string }>;
  calls: { list: number; get: Array<{ slug: string }> };
}

function makeSavedQueriesStub(initial: Partial<SavedQueriesStubState> = {}): {
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
  listing: SourceListing = TWO,
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
    providers: [
      provideRouter([{ path: 'query', component: QueryPage }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ConfigService, useValue: configStub },
      { provide: SavedQueriesService, useValue: savedQueriesStub.service },
    ],
  });

  const router = TestBed.inject(Router);
  await router.navigateByUrl(initialUrl);
  // DOM-free per ADR-0046: instantiate the class via DI rather than
  // through `createComponent`, so the view tree (and the YASQE/CodeMirror
  // child, which crashes in jsdom) never materialises.
  const page = TestBed.runInInjectionContext(() => new QueryPage());
  page.ngOnInit();
  await flushUrlSync();
  return {
    page,
    router,
    http: TestBed.inject(HttpTestingController),
    savedQueriesState: savedQueriesStub.state,
  };
}

/**
 * The URL-sync effect calls `router.navigate(...)` which returns a Promise
 * that resolves asynchronously; tests must drain microtasks before reading
 * `router.url`. We flush effects, then yield twice to let the navigation
 * promise + resulting routing pipeline settle.
 */
async function flushUrlSync(): Promise<void> {
  TestBed.flushEffects();
  await new Promise<void>((r) => setTimeout(r, 0));
  await new Promise<void>((r) => setTimeout(r, 0));
}

function urlParams(router: Router): URLSearchParams {
  const tree = router.parseUrl(router.url);
  const params = new URLSearchParams();
  for (const key of tree.queryParamMap.keys) {
    for (const v of tree.queryParamMap.getAll(key)) params.append(key, v);
  }
  return params;
}

describe('QueryPage · HTTP wiring', () => {
  it('Run posts SELECT with the SPARQL JSON Accept header and decodes the response into the result-pane state', async () => {
    const { page, http } = await setup();
    page.sourceId.set('a');
    page.query.set('SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 5');
    page.run();
    expect(page.resultState().kind).toBe('loading');

    const req = http.expectOne('/api/sparql/a');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBe('SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 5');
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

    const state = page.resultState();
    expect(state.kind).toBe('result');
    if (state.kind === 'result') {
      expect(state.result.kind).toBe('select');
      expect(state.result.contentType).toBe('application/sparql-results+json');
    }
    http.verify();
  });

  it('captures the X-Sparqly-Cache disposition into the result state (#418)', async () => {
    const { page, http } = await setup();
    page.sourceId.set('a');
    page.query.set('SELECT ?s WHERE { ?s ?p ?o }');
    page.run();

    http.expectOne('/api/sparql/a').flush(
      JSON.stringify({ head: { vars: ['s'] }, results: { bindings: [] } }),
      {
        headers: {
          'Content-Type': 'application/sparql-results+json',
          'X-Sparqly-Cache': 'hit',
        },
      },
    );

    const state = page.resultState();
    expect(state.kind).toBe('result');
    if (state.kind === 'result') {
      expect(state.cacheStatus).toBe('hit');
    }
    http.verify();
  });

  it('leaves cacheStatus unset when the response carries no X-Sparqly-Cache header', async () => {
    const { page, http } = await setup();
    page.sourceId.set('a');
    page.query.set('SELECT ?s WHERE { ?s ?p ?o }');
    page.run();

    http.expectOne('/api/sparql/a').flush(
      JSON.stringify({ head: { vars: ['s'] }, results: { bindings: [] } }),
      { headers: { 'Content-Type': 'application/sparql-results+json' } },
    );

    const state = page.resultState();
    expect(state.kind).toBe('result');
    if (state.kind === 'result') {
      expect(state.cacheStatus).toBeUndefined();
    }
    http.verify();
  });

  it('Force refresh re-runs with a Cache-Control: no-cache request header (#418)', async () => {
    const { page, http } = await setup();
    page.sourceId.set('a');
    page.query.set('SELECT ?s WHERE { ?s ?p ?o }');
    page.runRefresh();

    const req = http.expectOne('/api/sparql/a');
    expect(req.request.headers.get('Cache-Control')).toBe('no-cache');
    req.flush(
      JSON.stringify({ head: { vars: ['s'] }, results: { bindings: [] } }),
      {
        headers: {
          'Content-Type': 'application/sparql-results+json',
          'X-Sparqly-Cache': 'miss',
        },
      },
    );

    const state = page.resultState();
    expect(state.kind).toBe('result');
    if (state.kind === 'result') {
      expect(state.cacheStatus).toBe('miss');
    }
    http.verify();
  });

  it('a plain Run sends no Cache-Control header', async () => {
    const { page, http } = await setup();
    page.sourceId.set('a');
    page.query.set('SELECT ?s WHERE { ?s ?p ?o }');
    page.run();

    const req = http.expectOne('/api/sparql/a');
    expect(req.request.headers.has('Cache-Control')).toBe(false);
    req.flush(
      JSON.stringify({ head: { vars: ['s'] }, results: { bindings: [] } }),
      { headers: { 'Content-Type': 'application/sparql-results+json' } },
    );
    http.verify();
  });

  it('Run posts CONSTRUCT with the Turtle Accept header and decodes a triples result', async () => {
    const { page, http } = await setup();
    page.sourceId.set('a');
    page.query.set('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o } LIMIT 5');
    page.run();

    const req = http.expectOne('/api/sparql/a');
    expect(req.request.headers.get('Accept')).toBe('text/turtle');
    req.flush(
      '<http://example.org/s> <http://example.org/p> <http://example.org/o> .\n',
      { headers: { 'Content-Type': 'text/turtle' } },
    );

    const state = page.resultState();
    expect(state.kind).toBe('result');
    if (state.kind === 'result') {
      expect(state.result.kind).toBe('triples');
    }
    http.verify();
  });

  it('Run with an unrecognised query body sends no Accept header', async () => {
    const { page, http } = await setup();
    page.sourceId.set('a');
    page.query.set('   ');
    page.run();
    const req = http.expectOne('/api/sparql/a');
    expect(req.request.headers.has('Accept')).toBe(false);
    req.flush('', { headers: { 'Content-Type': 'text/plain' } });
    http.verify();
  });

  it('maps a 4xx failure into an error state carrying the parsed message', async () => {
    const { page, http } = await setup();
    page.sourceId.set('a');
    page.run();
    http
      .expectOne('/api/sparql/a')
      .flush(JSON.stringify({ message: 'malformed query' }), {
        status: 400,
        statusText: 'Bad Request',
      });

    const state = page.resultState();
    expect(state.kind).toBe('error');
    if (state.kind === 'error') expect(state.message).toBe('malformed query');
    http.verify();
  });

  it('discards prior result state when the user picks a different source', async () => {
    const { page, http } = await setup();
    page.sourceId.set('a');
    page.run();
    http
      .expectOne('/api/sparql/a')
      .flush(
        JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }),
        { headers: { 'Content-Type': 'application/sparql-results+json' } },
      );
    expect(page.resultState().kind).toBe('result');

    page.onSourceChange('b');
    expect(page.resultState().kind).toBe('empty');
    http.verify();
  });
});

describe('QueryPage · URL boot params', () => {
  it('seeds sourceId and query from ?source= and ?query= on construction', async () => {
    const { page } = await setup(
      TWO,
      '/query?source=a&query=' +
        encodeURIComponent('SELECT ?s WHERE { ?s ?p ?o }'),
    );
    expect(page.sourceId()).toBe('a');
    expect(page.query()).toBe('SELECT ?s WHERE { ?s ?p ?o }');
  });

  it('seeds the default starter query from the config context when no ?query= is given', async () => {
    const { page } = await setup(TWO, '/query', {
      prefixes: { ex: 'http://example.org/' },
      base: 'http://example.org/base/',
    });
    expect(page.query()).toContain('BASE <http://example.org/base/>');
    expect(page.query()).toContain('PREFIX ex: <http://example.org/>');
    expect(page.query()).toContain('?s ?p ?o');
  });

  it('does not overwrite a URL-supplied query with the default starter', async () => {
    const { page } = await setup(
      TWO,
      '/query?query=' + encodeURIComponent('ASK { ?s ?p ?o }'),
    );
    expect(page.query()).toBe('ASK { ?s ?p ?o }');
  });

  it('falls back to the default-flagged source when no ?source= is given', async () => {
    const { page } = await setup(TWO);
    expect(page.sourceId()).toBe('b');
  });

  it('preserves a pinned-address ?source=@<id>:<ref> through to the SPARQL endpoint URL', async () => {
    const { page, http } = await setup(
      TWO,
      '/query?source=' +
        encodeURIComponent('@a:v1.2.0') +
        '&query=' +
        encodeURIComponent('ASK { ?s ?p ?o }'),
    );
    expect(page.sourceId()).toBe('@a:v1.2.0');
    page.run();
    const req = http.expectOne(
      `/api/sparql/${encodeURIComponent('@a:v1.2.0')}`,
    );
    req.flush('', {
      headers: { 'Content-Type': 'application/sparql-results+json' },
    });
    http.verify();
  });
});

describe('QueryPage · URL effect', () => {
  it('mirrors picked source and editor text into ?source= and ?query=', async () => {
    const { page, router } = await setup();
    page.sourceId.set('a');
    page.query.set('SELECT ?s WHERE { ?s ?p ?o }');
    await flushUrlSync();

    const params = urlParams(router);
    expect(params.get('source')).toBe('a');
    expect(params.get('query')).toBe('SELECT ?s WHERE { ?s ?p ?o }');
  });
});

describe('QueryPage · saved-query run surface', () => {
  it('boots from ?savedQuery=<slug>: loads the entry body and pins the slug', async () => {
    const { page, savedQueriesState } = await setup(
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
    expect(page.query()).toBe('SELECT ?fromSlug');
    expect(page.pinnedSlug()).toBe('alpha');
    expect(page.loadError()).toBeNull();
  });

  it('keeps the URL as ?savedQuery=<slug> while the editor body matches the loaded entry', async () => {
    const { router } = await setup(
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
    await flushUrlSync();
    const params = urlParams(router);
    expect(params.get('savedQuery')).toBe('alpha');
    expect(params.get('query')).toBeNull();
  });

  it('transitions URL from ?savedQuery=<slug> to ?query=<sparql> when the editor body diverges', async () => {
    const { page, router } = await setup(
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
    page.query.set('SELECT ?edited');
    await flushUrlSync();

    expect(page.pinnedSlug()).toBeNull();
    const params = urlParams(router);
    expect(params.get('savedQuery')).toBeNull();
    expect(params.get('query')).toBe('SELECT ?edited');
  });

  it('when both ?savedQuery= and ?query= are present, ?savedQuery= wins and ?query= is dropped on load', async () => {
    const { page, router } = await setup(
      TWO,
      '/query?savedQuery=alpha&query=' + encodeURIComponent('SELECT ?ignored'),
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
    await flushUrlSync();
    expect(page.query()).toBe('SELECT ?loaded');
    expect(page.pinnedSlug()).toBe('alpha');
    const params = urlParams(router);
    expect(params.get('savedQuery')).toBe('alpha');
    expect(params.get('query')).toBeNull();
  });

  it('surfaces a not-found error when ?savedQuery=<unknown-slug> cannot be loaded', async () => {
    const { page } = await setup(
      TWO,
      '/query?savedQuery=ghost',
      { prefixes: {} },
      { list: [], entries: {} },
    );
    expect(page.loadError()).toEqual({ kind: 'not-found', slug: 'ghost' });
    expect(page.pinnedSlug()).toBeNull();
  });

  it('onLoad fetches the entry and pins the slug', async () => {
    const { page, savedQueriesState } = await setup(
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
    page.onLoad('alpha');
    expect(savedQueriesState.calls.get).toEqual([{ slug: 'alpha' }]);
    expect(page.query()).toBe('SELECT ?loaded');
    expect(page.pinnedSlug()).toBe('alpha');
  });

  it('list() runs once on init and entries are exposed on the savedQueries signal', async () => {
    const { page, savedQueriesState } = await setup(
      TWO,
      '/query',
      { prefixes: {} },
      { list: [{ slug: 'alpha', hasParameters: false }] },
    );
    expect(savedQueriesState.calls.list).toBe(1);
    expect(page.savedQueries().map((e) => e.slug)).toEqual(['alpha']);
  });
});

describe('QueryPage · templated saved-query runtime', () => {
  const TEMPLATE_BODY = 'SELECT * WHERE { ?s ?p ?o ; <urn:c> ?country }';
  const parameters: ParameterDeclaration[] = [
    { name: 'country', type: 'string', cardinality: '1..1' },
  ];

  it("threads the loaded entry's parameters list onto loadedParameters", async () => {
    const { page } = await setup(
      TWO,
      '/query?savedQuery=byc',
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
    expect(page.loadedParameters()).toEqual(parameters);
    expect(page.query()).toBe(TEMPLATE_BODY);
  });

  it('posts the substituted SPARQL when bindings are submitted', async () => {
    const { page, http } = await setup(
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
    page.onSubmitBindings({ country: 'CA' });
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

describe('QueryPage · templated saved-query URL bindings', () => {
  const TEMPLATE_BODY = 'SELECT * WHERE { ?s ?p ?o ; <urn:c> ?country }';
  const parameters: ParameterDeclaration[] = [
    { name: 'country', type: 'string', cardinality: '1..1' },
  ];

  it('parses ?bind.<name>=<value> from the URL into initialBindings', async () => {
    const { page } = await setup(
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
    expect(page.initialBindings()).toEqual({ country: 'CA' });
  });

  it('history-replaces the URL with ?bind.<name>=<value> on submit', async () => {
    const { page, http, router } = await setup(
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
    page.onSubmitBindings({ country: 'FR' } as ParameterBindings);
    await flushUrlSync();

    const params = urlParams(router);
    expect(params.get('savedQuery')).toBe('byc');
    expect(params.get('bind.country')).toBe('FR');
    expect(params.get('query')).toBeNull();

    http
      .expectOne('/api/sparql/a')
      .flush(
        JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }),
        { headers: { 'Content-Type': 'application/sparql-results+json' } },
      );
    http.verify();
  });

  it('drops ?savedQuery= and ?bind.* keys when the editor body diverges from the loaded entry', async () => {
    const { page, router } = await setup(
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
    page.query.set('SELECT ?edited');
    await flushUrlSync();

    const params = urlParams(router);
    expect(params.get('savedQuery')).toBeNull();
    expect(params.get('bind.country')).toBeNull();
    expect(params.get('query')).toBe('SELECT ?edited');
  });

  it('emits repeated ?bind.<name>= keys when the submitted binding is an array', async () => {
    const multiParams: ParameterDeclaration[] = [
      { name: 'tag', type: 'string', cardinality: '1..n' },
    ];
    const { page, http, router } = await setup(
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
    page.onSubmitBindings({ tag: ['a', 'b'] });
    await flushUrlSync();

    const params = urlParams(router);
    expect(params.getAll('bind.tag')).toEqual(['a', 'b']);

    http
      .expectOne('/api/sparql/a')
      .flush(
        JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }),
        { headers: { 'Content-Type': 'application/sparql-results+json' } },
      );
    http.verify();
  });

  it('accumulates repeated ?bind.<name>= keys into an array for cardinality-n parameters', async () => {
    const multiParams: ParameterDeclaration[] = [
      { name: 'tag', type: 'string', cardinality: '1..n' },
    ];
    const { page } = await setup(
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
    expect(page.initialBindings()).toEqual({ tag: ['a', 'b'] });
  });
});
