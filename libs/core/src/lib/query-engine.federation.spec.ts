import { afterEach, describe, expect, it } from 'vitest';
import { QueryEngine } from './query-engine';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './test/fake-sparql-endpoint';

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

describe('QueryEngine — pass-through federation', () => {
  let endpoint: FakeSparqlEndpoint | undefined;

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
  });

  it('federates a SELECT query to the endpoint and returns SPARQL JSON', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON_TWO_BINDINGS,
    }));

    const engine = new QueryEngine({
      kind: 'endpoint',
      endpoint: endpoint.url,
    });

    const result = await engine.execute('SELECT ?s WHERE { ?s ?p ?o }');

    expect(result.format).toBe('json');
    expect(result.contentType).toBe('application/sparql-results+json');
    const parsed = JSON.parse(result.body);
    const subjects = parsed.results.bindings
      .map((b: { s: { value: string } }) => b.s.value)
      .sort();
    expect(subjects).toEqual([
      'http://example.org/a',
      'http://example.org/c',
    ]);
    expect(endpoint.requestCount()).toBeGreaterThan(0);
  });

  it('forwards bearer auth as `Authorization: Bearer <token>` on the upstream request', async () => {
    let observedAuth: string | undefined;
    endpoint = await startFakeSparqlEndpoint(({ headers }) => {
      const v = headers['authorization'];
      observedAuth = Array.isArray(v) ? v[0] : v;
      return {
        contentType: 'application/sparql-results+json',
        body: SPARQL_JSON_TWO_BINDINGS,
      };
    });

    const engine = new QueryEngine({
      kind: 'endpoint',
      endpoint: endpoint.url,
      auth: { type: 'bearer', token: 'tk-1' },
    });

    await engine.execute('SELECT ?s WHERE { ?s ?p ?o }');

    expect(observedAuth).toBe('Bearer tk-1');
  });

  it('forwards custom headers (escape hatch) verbatim on the upstream request', async () => {
    let observed: Record<string, string | string[] | undefined> = {};
    endpoint = await startFakeSparqlEndpoint(({ headers }) => {
      observed = headers;
      return {
        contentType: 'application/sparql-results+json',
        body: SPARQL_JSON_TWO_BINDINGS,
      };
    });

    const engine = new QueryEngine({
      kind: 'endpoint',
      endpoint: endpoint.url,
      headers: { 'X-Tenant': 'acme' },
    });

    await engine.execute('SELECT ?s WHERE { ?s ?p ?o }');

    const tenant = observed['x-tenant'];
    expect(Array.isArray(tenant) ? tenant[0] : tenant).toBe('acme');
  });

  it('honors a per-source timeoutMs (slow endpoint surfaces a hard error)', async () => {
    endpoint = await startFakeSparqlEndpoint(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return {
        contentType: 'application/sparql-results+json',
        body: SPARQL_JSON_TWO_BINDINGS,
      };
    });

    const engine = new QueryEngine({
      kind: 'endpoint',
      endpoint: endpoint.url,
      timeoutMs: 25,
    });

    await expect(
      engine.execute('SELECT ?s WHERE { ?s ?p ?o }'),
    ).rejects.toThrow();
  });
});
