import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { DiffService, type DiffResponse } from './diff.service';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    http: TestBed.inject(HttpTestingController),
    service: TestBed.inject(DiffService),
  };
}

describe('DiffService', () => {
  it('POSTs /api/diff with the body and resolves with the JSON response', async () => {
    const { http, service } = setup();
    const promise = new Promise<DiffResponse>((resolve) =>
      service
        .run({
          left: 'a',
          right: 'b',
          leftQuery: 'q1',
          rightQuery: 'q2',
        })
        .subscribe(resolve),
    );
    const req = http.expectOne('/api/diff');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      left: 'a',
      right: 'b',
      leftQuery: 'q1',
      rightQuery: 'q2',
    });
    const response: DiffResponse = {
      kind: 'grouped',
      hunked: {
        changed: [],
        removed: [],
        added: [],
        totals: { left: 0, right: 0 },
      },
    };
    req.flush(response);
    expect(await promise).toEqual(response);
    http.verify();
  });

  it('omits leftQuery and rightQuery from the body when not provided', () => {
    const { http, service } = setup();
    service.run({ left: 'a', right: 'b' }).subscribe();
    const req = http.expectOne('/api/diff');
    expect(req.request.body).toEqual({ left: 'a', right: 'b' });
    req.flush({ kind: 'error', errors: { top: 'noop' } });
    http.verify();
  });
});
