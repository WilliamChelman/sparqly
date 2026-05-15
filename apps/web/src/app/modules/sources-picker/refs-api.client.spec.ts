import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { RefsApiClient, type RefsLoadResult, type RefsResponse } from './refs-api.client';

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
});
