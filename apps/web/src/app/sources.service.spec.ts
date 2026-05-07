import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { SourcesService, type SourceListing } from './sources.service';

const LISTING: SourceListing = {
  sources: [
    { id: 'a', kind: 'glob', label: 'A (glob)' },
    { id: 'b', kind: 'glob', label: 'B (glob)', default: true },
  ],
};

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    http: TestBed.inject(HttpTestingController),
    service: TestBed.inject(SourcesService),
  };
}

describe('SourcesService', () => {
  it('GETs /api/sources and resolves with the parsed listing', async () => {
    const { http, service } = setup();
    const promise = new Promise<SourceListing>((resolve) =>
      service.list().subscribe(resolve),
    );
    const req = http.expectOne('/api/sources');
    expect(req.request.method).toBe('GET');
    req.flush(LISTING);
    expect(await promise).toEqual(LISTING);
    http.verify();
  });
});
