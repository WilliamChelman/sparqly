import { afterEach, describe, expect, it } from 'vitest';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';
import { runCli } from './helpers/run-cli';

const SPARQL_JSON_TWO_BINDINGS = JSON.stringify({
  head: { vars: ['s', 'p', 'o'] },
  results: {
    bindings: [
      {
        s: { type: 'uri', value: 'http://example.org/a' },
        p: { type: 'uri', value: 'http://example.org/p' },
        o: { type: 'uri', value: 'http://example.org/b' },
      },
      {
        s: { type: 'uri', value: 'http://example.org/c' },
        p: { type: 'uri', value: 'http://example.org/p' },
        o: { type: 'uri', value: 'http://example.org/d' },
      },
    ],
  },
});

describe('sparqly query — SPARQL endpoint source', () => {
  let endpoint: FakeSparqlEndpoint | undefined;

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
  });

  it('answers a SELECT against a single remote endpoint URL via pass-through federation', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON_TWO_BINDINGS,
    }));

    const result = await runCli([
      'query',
      endpoint.url,
      '-q',
      'SELECT ?s WHERE { ?s ?p ?o } ORDER BY ?s',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const json = JSON.parse(result.stdout);
    const subjects = json.results.bindings.map(
      (b: { s: { value: string } }) => b.s.value,
    );
    expect(subjects).toEqual([
      'http://example.org/a',
      'http://example.org/c',
    ]);
  });

  it('surfaces the failing endpoint URL when the upstream returns 5xx', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      status: 503,
      contentType: 'text/plain',
      body: 'upstream busy',
    }));

    const url = endpoint.url;
    const result = await runCli([
      'query',
      url,
      '-q',
      'SELECT ?s WHERE { ?s ?p ?o }',
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(url);
  });
});
