import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
  SnippetService,
  type SnippetReadResult,
} from './snippet.service';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    service: TestBed.inject(SnippetService),
    http: TestBed.inject(HttpTestingController),
  };
}

const tick = () => Promise.resolve();

const snippetReq = (http: HttpTestingController) =>
  http.expectOne((r) => r.url.split('?')[0] === '/api/source-snippet');

describe('SnippetService', () => {
  it('coalesces same-file fetches in a microtask into one GET with one `range` param per call, aligned snippet results', async () => {
    const { service, http } = setup();
    const a: SnippetReadResult[] = [];
    const b: SnippetReadResult[] = [];
    service
      .fetch('file:///tmp/x.ttl', { focalStart: 3, focalEnd: 3 }, 2)
      .subscribe((r) => a.push(r));
    service
      .fetch('file:///tmp/x.ttl', { focalStart: 10, focalEnd: 12 }, 2)
      .subscribe((r) => b.push(r));

    await tick();

    const req = snippetReq(http);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('file')).toBe('file:///tmp/x.ttl');
    expect(req.request.params.get('snippetContext')).toBe('2');
    expect(req.request.params.getAll('range')).toEqual(['3', '10-12']);

    req.flush({
      snippets: [
        { kind: 'snippet', startLine: 1, focalStart: 3, focalEnd: 3, lines: ['L1', 'L2', 'L3', 'L4', 'L5'] },
        { kind: 'snippet', startLine: 8, focalStart: 10, focalEnd: 12, lines: ['L8', 'L9', 'L10', 'L11', 'L12'] },
      ],
    });

    expect(a).toEqual([
      { kind: 'snippet', startLine: 1, focalStart: 3, focalEnd: 3, lines: ['L1', 'L2', 'L3', 'L4', 'L5'] },
    ]);
    expect(b).toEqual([
      { kind: 'snippet', startLine: 8, focalStart: 10, focalEnd: 12, lines: ['L8', 'L9', 'L10', 'L11', 'L12'] },
    ]);
    http.verify();
  });

  it('issues a separate GET per distinct file fetched in the same microtask', async () => {
    const { service, http } = setup();
    service.fetch('file:///a.ttl', { focalStart: 1, focalEnd: 1 }, 0).subscribe();
    service.fetch('file:///b.ttl', { focalStart: 2, focalEnd: 2 }, 0).subscribe();

    await tick();

    const reqs = http.match((r) => r.url.split('?')[0] === '/api/source-snippet');
    expect(reqs.length).toBe(2);
    expect(reqs.map((r) => r.request.params.get('file')).sort()).toEqual([
      'file:///a.ttl',
      'file:///b.ttl',
    ]);
    for (const r of reqs) {
      r.flush({
        snippets: [
          { kind: 'snippet', startLine: 1, focalStart: 1, focalEnd: 1, lines: ['only'] },
        ],
      });
    }
    http.verify();
  });

  it('resolves every pending fetch to a structured `file-read` error carrying path + reason when the server returns 500 with a SnippetError body', async () => {
    const { service, http } = setup();
    const got: SnippetReadResult[] = [];
    service.fetch('file:///x.ttl', { focalStart: 1, focalEnd: 1 }, 0).subscribe((r) => got.push(r));
    service.fetch('file:///x.ttl', { focalStart: 5, focalEnd: 5 }, 0).subscribe((r) => got.push(r));

    await tick();

    snippetReq(http).flush(
      { kind: 'file-read', file: '/abs/x.ttl', reason: 'missing' },
      { status: 500, statusText: 'Server Error' },
    );

    expect(got).toEqual([
      { kind: 'file-read', file: '/abs/x.ttl', reason: 'missing' },
      { kind: 'file-read', file: '/abs/x.ttl', reason: 'missing' },
    ]);
    http.verify();
  });

  it('resolves every pending fetch to a structured `range-out-of-bounds` error when the server returns 400 with that body', async () => {
    const { service, http } = setup();
    const got: SnippetReadResult[] = [];
    service.fetch('file:///x.ttl', { focalStart: 999, focalEnd: 999 }, 0).subscribe((r) => got.push(r));

    await tick();

    snippetReq(http).flush(
      { kind: 'range-out-of-bounds', spec: '999' },
      { status: 400, statusText: 'Bad Request' },
    );

    expect(got).toEqual([{ kind: 'range-out-of-bounds', spec: '999' }]);
    http.verify();
  });

  it('falls back to `unavailable: missing` when the GET fails without a structured SnippetError body', async () => {
    const { service, http } = setup();
    const got: SnippetReadResult[] = [];
    service.fetch('file:///x.ttl', { focalStart: 1, focalEnd: 1 }, 0).subscribe((r) => got.push(r));

    await tick();

    snippetReq(http).flush('boom', { status: 502, statusText: 'Bad Gateway' });

    expect(got).toEqual([{ kind: 'unavailable', reason: 'missing' }]);
    http.verify();
  });

  it('starts a fresh batch for the next microtask', async () => {
    const { service, http } = setup();
    service.fetch('file:///x.ttl', { focalStart: 1, focalEnd: 1 }, 0).subscribe();
    await tick();
    snippetReq(http).flush({
      snippets: [{ kind: 'snippet', startLine: 1, focalStart: 1, focalEnd: 1, lines: ['only'] }],
    });

    service.fetch('file:///x.ttl', { focalStart: 2, focalEnd: 2 }, 0).subscribe();
    await tick();
    const second = snippetReq(http);
    expect(second.request.params.getAll('range')).toEqual(['2']);
    second.flush({
      snippets: [{ kind: 'snippet', startLine: 2, focalStart: 2, focalEnd: 2, lines: ['L2'] }],
    });
    http.verify();
  });
});
