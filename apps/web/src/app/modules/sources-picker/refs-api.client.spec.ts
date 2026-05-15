import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import {
  RefsApiClient,
  type RefreshResult,
  type RefsLoadResult,
  type RefsResponse,
} from './refs-api.client';

const REFS: RefsResponse = {
  head: { ref: 'HEAD', sha: 'a'.repeat(40), kind: 'head' },
  branches: [{ ref: 'main', sha: 'a'.repeat(40), kind: 'branch' }],
  remoteBranches: [],
  tags: [],
};

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      RefsApiClient,
    ],
  });
  return {
    http: TestBed.inject(HttpTestingController),
    client: TestBed.inject(RefsApiClient),
  };
}

describe('RefsApiClient', () => {
  it('GETs /api/sources/:id/refs and resolves with state:ok and the response body', async () => {
    const { http, client } = setup();
    const promise = firstValueFrom(client.load('docs'));
    const req = http.expectOne('/api/sources/docs/refs');
    expect(req.request.method).toBe('GET');
    req.flush(REFS);
    const result = await promise;
    expect(result).toEqual<RefsLoadResult>({ state: 'ok', refs: REFS });
    http.verify();
  });

  it('translates a 404 { error: "no-git-repo", kind } body into a state:no-git-repo result (not a thrown error)', async () => {
    const { http, client } = setup();
    const promise = firstValueFrom(client.load('only-endpoint'));
    const req = http.expectOne('/api/sources/only-endpoint/refs');
    req.flush(
      { error: 'no-git-repo', kind: 'endpoint' },
      { status: 404, statusText: 'Not Found' },
    );
    const result = await promise;
    expect(result).toEqual<RefsLoadResult>({
      state: 'no-git-repo',
      kind: 'endpoint',
    });
    http.verify();
  });

  it('caches the result per source id — a second load() for the same id emits no new HTTP request', async () => {
    const { http, client } = setup();
    const first = firstValueFrom(client.load('docs'));
    http.expectOne('/api/sources/docs/refs').flush(REFS);
    await first;
    const second = await firstValueFrom(client.load('docs'));
    expect(second).toEqual<RefsLoadResult>({ state: 'ok', refs: REFS });
    http.verify();
  });

  it('refresh(id) POSTs /api/sources/:id/refs/fetch and resolves with state:ok and the response body', async () => {
    const { http, client } = setup();
    const promise = firstValueFrom(client.refresh('docs'));
    const req = http.expectOne('/api/sources/docs/refs/fetch');
    expect(req.request.method).toBe('POST');
    req.flush(REFS);
    const result = await promise;
    expect(result).toEqual<RefsLoadResult>({ state: 'ok', refs: REFS });
    http.verify();
  });

  it('after a successful refresh, the cache entry for that source is replaced — a subsequent load() returns the fresh response with no new HTTP request', async () => {
    const { http, client } = setup();

    const initialLoad = firstValueFrom(client.load('docs'));
    http.expectOne('/api/sources/docs/refs').flush(REFS);
    await initialLoad;

    const fresh: RefsResponse = {
      head: { ref: 'HEAD', sha: 'b'.repeat(40), kind: 'head' },
      branches: [{ ref: 'main', sha: 'b'.repeat(40), kind: 'branch' }],
      remoteBranches: [],
      tags: [],
    };
    const refreshPromise = firstValueFrom(client.refresh('docs'));
    http.expectOne('/api/sources/docs/refs/fetch').flush(fresh);
    await refreshPromise;

    const reloaded = await firstValueFrom(client.load('docs'));
    expect(reloaded).toEqual<RefsLoadResult>({ state: 'ok', refs: fresh });
    http.verify();
  });

  it('refreshing one source leaves another source\'s cache entry untouched', async () => {
    const { http, client } = setup();

    const otherRefs: RefsResponse = {
      head: { ref: 'HEAD', sha: 'c'.repeat(40), kind: 'head' },
      branches: [{ ref: 'release', sha: 'c'.repeat(40), kind: 'branch' }],
      remoteBranches: [],
      tags: [],
    };

    const loadDocs = firstValueFrom(client.load('docs'));
    http.expectOne('/api/sources/docs/refs').flush(REFS);
    await loadDocs;

    const loadOther = firstValueFrom(client.load('other'));
    http.expectOne('/api/sources/other/refs').flush(otherRefs);
    await loadOther;

    const fresh: RefsResponse = {
      head: { ref: 'HEAD', sha: 'b'.repeat(40), kind: 'head' },
      branches: [{ ref: 'main', sha: 'b'.repeat(40), kind: 'branch' }],
      remoteBranches: [],
      tags: [],
    };
    const refreshPromise = firstValueFrom(client.refresh('docs'));
    http.expectOne('/api/sources/docs/refs/fetch').flush(fresh);
    await refreshPromise;

    // No new HTTP for 'other' — its cache survives.
    const otherReloaded = await firstValueFrom(client.load('other'));
    expect(otherReloaded).toEqual<RefsLoadResult>({ state: 'ok', refs: otherRefs });
    http.verify();
  });

  it('translates a 502 { error: "fetch-failed", kind } body into a state:"fetch-failed" result (not a thrown error), and leaves the existing cache entry untouched', async () => {
    const { http, client } = setup();

    const loadDocs = firstValueFrom(client.load('docs'));
    http.expectOne('/api/sources/docs/refs').flush(REFS);
    await loadDocs;

    const refreshPromise = firstValueFrom(client.refresh('docs'));
    http.expectOne('/api/sources/docs/refs/fetch').flush(
      { error: 'fetch-failed', kind: 'network' },
      { status: 502, statusText: 'Bad Gateway' },
    );
    const result = await refreshPromise;
    expect(result).toEqual<RefreshResult>({ state: 'fetch-failed', kind: 'network' });

    // Cache survived the failure — a subsequent load() returns the pre-refresh value
    // with no new HTTP.
    const reloaded = await firstValueFrom(client.load('docs'));
    expect(reloaded).toEqual<RefsLoadResult>({ state: 'ok', refs: REFS });
    http.verify();
  });
});
