import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  SavedQueriesService,
  type DeleteResult,
  type LoadedSavedQuery,
  type PutResult,
  type SavedQuerySummary,
} from './saved-queries.service';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    http: TestBed.inject(HttpTestingController),
    service: TestBed.inject(SavedQueriesService),
  };
}

describe('SavedQueriesService', () => {
  describe('list()', () => {
    it('GETs /api/saved-queries and resolves with the list of summaries', async () => {
      const { http, service } = setup();
      const payload: SavedQuerySummary[] = [
        { slug: 'a', hasParameters: false },
        { slug: 'b', description: 'Bee', hasParameters: false },
      ];
      const promise = new Promise<readonly SavedQuerySummary[]>((resolve) =>
        service.list().subscribe(resolve),
      );
      const req = http.expectOne('/api/saved-queries');
      expect(req.request.method).toBe('GET');
      req.flush(payload);
      expect(await promise).toEqual(payload);
      http.verify();
    });
  });

  describe('get()', () => {
    it('GETs /api/saved-queries/:slug and returns the entry plus the ETag header', async () => {
      const { http, service } = setup();
      const promise = new Promise<LoadedSavedQuery>((resolve) =>
        service.get('alpha').subscribe(resolve),
      );
      const req = http.expectOne('/api/saved-queries/alpha');
      expect(req.request.method).toBe('GET');
      req.flush(
        { slug: 'alpha', body: 'SELECT * WHERE { ?s ?p ?o }' },
        { headers: { ETag: '"abc123"' } },
      );
      const loaded = await promise;
      expect(loaded.entry).toEqual({
        slug: 'alpha',
        body: 'SELECT * WHERE { ?s ?p ?o }',
      });
      expect(loaded.etag).toBe('abc123');
      http.verify();
    });
  });

  describe('put()', () => {
    it('PUTs to /api/saved-queries/:slug without If-Match and resolves with the new ETag', async () => {
      const { http, service } = setup();
      const promise = new Promise<PutResult>((resolve) =>
        service
          .put('alpha', { body: 'SELECT *' })
          .subscribe(resolve),
      );
      const req = http.expectOne('/api/saved-queries/alpha');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ body: 'SELECT *' });
      expect(req.request.headers.has('If-Match')).toBe(false);
      req.flush(
        { slug: 'alpha', body: 'SELECT *' },
        { status: 201, statusText: 'Created', headers: { ETag: '"e1"' } },
      );
      expect(await promise).toEqual({ kind: 'saved', etag: 'e1' });
      http.verify();
    });

    it('sends If-Match when ifMatch is provided', async () => {
      const { http, service } = setup();
      service
        .put('alpha', { body: 'SELECT *' }, 'old-etag')
        .subscribe();
      const req = http.expectOne('/api/saved-queries/alpha');
      expect(req.request.headers.get('If-Match')).toBe('"old-etag"');
      req.flush(
        { slug: 'alpha', body: 'SELECT *' },
        { status: 200, statusText: 'OK', headers: { ETag: '"e2"' } },
      );
      http.verify();
    });

    it('maps 412 Precondition Failed to kind: "stale"', async () => {
      const { http, service } = setup();
      const promise = new Promise<PutResult>((resolve) =>
        service
          .put('alpha', { body: 'SELECT *' }, 'stale-etag')
          .subscribe(resolve),
      );
      const req = http.expectOne('/api/saved-queries/alpha');
      req.flush(
        { error: 'etag-mismatch', slug: 'alpha' },
        { status: 412, statusText: 'Precondition Failed' },
      );
      expect(await promise).toEqual({ kind: 'stale' });
      http.verify();
    });

    it('includes parameters in the PUT body when provided', async () => {
      const { http, service } = setup();
      service
        .put('alpha', {
          body: 'SELECT ?country WHERE { ?country a :Country }',
          parameters: [
            { name: 'country', type: 'string', cardinality: '1..1' },
          ],
        })
        .subscribe();
      const req = http.expectOne('/api/saved-queries/alpha');
      expect(req.request.body).toEqual({
        body: 'SELECT ?country WHERE { ?country a :Country }',
        parameters: [
          { name: 'country', type: 'string', cardinality: '1..1' },
        ],
      });
      req.flush(
        {
          slug: 'alpha',
          body: 'SELECT ?country WHERE { ?country a :Country }',
        },
        { status: 200, statusText: 'OK', headers: { ETag: '"e3"' } },
      );
      http.verify();
    });

    it('maps 409 Conflict to kind: "slug-exists"', async () => {
      const { http, service } = setup();
      const promise = new Promise<PutResult>((resolve) =>
        service
          .put('alpha', { body: 'SELECT *' })
          .subscribe(resolve),
      );
      const req = http.expectOne('/api/saved-queries/alpha');
      req.flush(
        { error: 'slug-exists', slug: 'alpha' },
        { status: 409, statusText: 'Conflict' },
      );
      expect(await promise).toEqual({ kind: 'slug-exists' });
      http.verify();
    });
  });

  describe('delete()', () => {
    it('DELETEs /api/saved-queries/:slug with If-Match and resolves with kind: "deleted"', async () => {
      const { http, service } = setup();
      const promise = new Promise<DeleteResult>((resolve) =>
        service.delete('alpha', 'cur-etag').subscribe(resolve),
      );
      const req = http.expectOne('/api/saved-queries/alpha');
      expect(req.request.method).toBe('DELETE');
      expect(req.request.headers.get('If-Match')).toBe('"cur-etag"');
      req.flush(null, { status: 204, statusText: 'No Content' });
      expect(await promise).toEqual({ kind: 'deleted' });
      http.verify();
    });

    it('maps 412 Precondition Failed to kind: "stale"', async () => {
      const { http, service } = setup();
      const promise = new Promise<DeleteResult>((resolve) =>
        service.delete('alpha', 'stale-etag').subscribe(resolve),
      );
      const req = http.expectOne('/api/saved-queries/alpha');
      req.flush(
        { error: 'etag-mismatch' },
        { status: 412, statusText: 'Precondition Failed' },
      );
      expect(await promise).toEqual({ kind: 'stale' });
      http.verify();
    });
  });
});
