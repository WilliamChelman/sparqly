import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
  SparqlClientService,
  type SparqlRunOutcome,
} from './sparql-client.service';

const SELECT_JSON = JSON.stringify({
  head: { vars: ['s'] },
  results: { bindings: [] },
});

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    http: TestBed.inject(HttpTestingController),
    service: TestBed.inject(SparqlClientService),
  };
}

function collect(
  outcomes: SparqlRunOutcome[],
): (outcome: SparqlRunOutcome) => void {
  return (outcome) => outcomes.push(outcome);
}

describe('SparqlClientService', () => {
  it('POSTs to the source endpoint with SPARQL protocol headers and decodes the outcome', () => {
    const { http, service } = setup();
    const outcomes: SparqlRunOutcome[] = [];
    service
      .run('my source', 'SELECT ?s WHERE { ?s ?p ?o }')
      .subscribe(collect(outcomes));

    const req = http.expectOne('/api/sparql/my%20source');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBe('SELECT ?s WHERE { ?s ?p ?o }');
    expect(req.request.headers.get('Content-Type')).toBe(
      'application/sparql-query',
    );
    expect(req.request.headers.get('Accept')).toBe(
      'application/sparql-results+json',
    );
    expect(req.request.headers.has('Cache-Control')).toBe(false);
    req.flush(SELECT_JSON, {
      headers: {
        'Content-Type': 'application/sparql-results+json',
        'X-Sparqly-Cache': 'hit',
      },
    });

    expect(outcomes).toHaveLength(1);
    const outcome = outcomes[0];
    expect(outcome.kind).toBe('result');
    if (outcome.kind === 'result') {
      expect(outcome.result.kind).toBe('select');
      expect(outcome.cacheStatus).toBe('hit');
    }
    http.verify();
  });

  it('refresh sends the Cache-Control: no-cache directive (ADR-0054, #418)', () => {
    const { http, service } = setup();
    const outcomes: SparqlRunOutcome[] = [];
    service
      .run('a', 'SELECT ?s WHERE { ?s ?p ?o }', { refresh: true })
      .subscribe(collect(outcomes));

    const req = http.expectOne('/api/sparql/a');
    expect(req.request.headers.get('Cache-Control')).toBe('no-cache');
    req.flush(SELECT_JSON, {
      headers: {
        'Content-Type': 'application/sparql-results+json',
        'X-Sparqly-Cache': 'miss',
      },
    });

    expect(outcomes[0]?.kind).toBe('result');
    if (outcomes[0]?.kind === 'result') {
      expect(outcomes[0].cacheStatus).toBe('miss');
    }
    http.verify();
  });

  it('negotiates Accept from the query type and leaves cacheStatus unset without the header', () => {
    const { http, service } = setup();
    const outcomes: SparqlRunOutcome[] = [];
    service
      .run('a', 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }')
      .subscribe(collect(outcomes));

    const construct = http.expectOne('/api/sparql/a');
    expect(construct.request.headers.get('Accept')).toBe('text/turtle');
    construct.flush('<urn:s> <urn:p> <urn:o> .\n', {
      headers: { 'Content-Type': 'text/turtle' },
    });
    expect(outcomes[0]?.kind).toBe('result');
    if (outcomes[0]?.kind === 'result') {
      expect(outcomes[0].cacheStatus).toBeUndefined();
    }

    service.run('a', 'not a sparql query').subscribe(collect(outcomes));
    const unknown = http.expectOne('/api/sparql/a');
    expect(unknown.request.headers.has('Accept')).toBe(false);
    unknown.flush('', { headers: { 'Content-Type': 'text/plain' } });
    http.verify();
  });

  it('folds an HTTP failure into an error outcome carrying the parsed message', () => {
    const { http, service } = setup();
    const outcomes: SparqlRunOutcome[] = [];
    service
      .run('a', 'SELECT ?s WHERE { ?s ?p')
      .subscribe(collect(outcomes));

    http.expectOne('/api/sparql/a').flush(
      JSON.stringify({ message: 'malformed query' }),
      { status: 400, statusText: 'Bad Request' },
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toEqual({ kind: 'error', message: 'malformed query' });
    http.verify();
  });
});
