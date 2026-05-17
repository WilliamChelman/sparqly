import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
  ConfigService,
  type ConfigPayload,
  type SourceListing,
} from './config.service';

const PAYLOAD: ConfigPayload = {
  sources: [
    { id: 'a', kind: 'glob', label: 'A (glob)' },
    { id: 'b', kind: 'glob', label: 'B (glob)', default: true },
  ],
  context: { prefixes: { ex: 'http://example.org/' }, base: 'http://x/' },
  describe: {
    perSourceSoftLimit: 10000,
    perSourceHardLimit: 100000,
    fromSourcePredicate: 'urn:sparqly:fromSource',
  },
  savedQueries: { writable: true },
};

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    http: TestBed.inject(HttpTestingController),
    service: TestBed.inject(ConfigService),
  };
}

describe('ConfigService', () => {
  it('GETs /api/config and resolves with the parsed payload', async () => {
    const { http, service } = setup();
    const promise = new Promise<ConfigPayload>((resolve) =>
      service.config().subscribe(resolve),
    );
    const req = http.expectOne('/api/config');
    expect(req.request.method).toBe('GET');
    req.flush(PAYLOAD);
    expect(await promise).toEqual(PAYLOAD);
    http.verify();
  });

  it('list() returns just the sources from /api/config', async () => {
    const { http, service } = setup();
    const promise = new Promise<SourceListing>((resolve) =>
      service.list().subscribe(resolve),
    );
    const req = http.expectOne('/api/config');
    req.flush(PAYLOAD);
    expect(await promise).toEqual({ sources: PAYLOAD.sources });
    http.verify();
  });

  it('context() returns just the context block from /api/config', async () => {
    const { http, service } = setup();
    const promise = new Promise<ConfigPayload['context']>((resolve) =>
      service.context().subscribe(resolve),
    );
    const req = http.expectOne('/api/config');
    req.flush(PAYLOAD);
    expect(await promise).toEqual(PAYLOAD.context);
    http.verify();
  });

  it('savedQueries() returns just the savedQueries block from /api/config', async () => {
    const { http, service } = setup();
    const promise = new Promise<ConfigPayload['savedQueries']>((resolve) =>
      service.savedQueries().subscribe(resolve),
    );
    const req = http.expectOne('/api/config');
    req.flush(PAYLOAD);
    expect(await promise).toEqual({ writable: true });
    http.verify();
  });

  it('treats a missing savedQueries.writable as writable=true (read-only opt-in)', async () => {
    const { http, service } = setup();
    const promise = new Promise<ConfigPayload['savedQueries']>((resolve) =>
      service.savedQueries().subscribe(resolve),
    );
    const req = http.expectOne('/api/config');
    req.flush({ ...PAYLOAD, savedQueries: undefined });
    expect(await promise).toEqual({ writable: true });
    http.verify();
  });

  it('describe() returns just the describe block from /api/config', async () => {
    const { http, service } = setup();
    const promise = new Promise<ConfigPayload['describe']>((resolve) =>
      service.describe().subscribe(resolve),
    );
    const req = http.expectOne('/api/config');
    req.flush(PAYLOAD);
    expect(await promise).toEqual(PAYLOAD.describe);
    http.verify();
  });
});
