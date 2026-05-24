import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { describe, expect, it } from 'vitest';
import {
  SourceActionsService,
  type ProbeResult,
} from './source-actions.service';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    service: TestBed.inject(SourceActionsService),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('SourceActionsService', () => {
  it.each([
    ['load', '/api/sources/docs/load'],
    ['reload', '/api/sources/docs/reload'],
    ['unload', '/api/sources/docs/unload'],
  ] as const)('POSTs the verb URL for %s', (verb, url) => {
    const { service, http } = setup();
    service[verb]('docs').subscribe();
    const req = http.expectOne(url);
    expect(req.request.method).toBe('POST');
    req.flush(null);
    http.verify();
  });

  it('URL-encodes the source id', () => {
    const { service, http } = setup();
    service.load('docs/sub a').subscribe();
    http.expectOne('/api/sources/docs%2Fsub%20a/load').flush(null);
    http.verify();
  });

  it('POSTs the rebuild-index URL', () => {
    const { service, http } = setup();
    service.rebuildIndex('big').subscribe();
    const req = http.expectOne('/api/sources/big/index-build');
    expect(req.request.method).toBe('POST');
    req.flush(null);
    http.verify();
  });

  it('DELETEs the rebuild-index URL to cancel', () => {
    const { service, http } = setup();
    service.cancelBuild('big').subscribe();
    const req = http.expectOne('/api/sources/big/index-build');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    http.verify();
  });

  it('passes the probe result back from test-connection', async () => {
    const { service, http } = setup();
    const promise = new Promise<ProbeResult>((resolve) =>
      service.testConnection('wikidata').subscribe(resolve),
    );
    const req = http.expectOne('/api/sources/wikidata/test-connection');
    expect(req.request.method).toBe('POST');
    req.flush({ ok: true, latencyMs: 42 } satisfies ProbeResult);
    expect(await promise).toEqual({ ok: true, latencyMs: 42 });
    http.verify();
  });
});
