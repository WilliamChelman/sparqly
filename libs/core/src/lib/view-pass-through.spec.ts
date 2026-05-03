import { afterEach, describe, expect, it } from 'vitest';
import {
  parseSourceSpecs,
  type ParsedEndpointSource,
} from './source-spec';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './test/fake-sparql-endpoint';
import { resolveViewPassThrough } from './view-pass-through';

const SPARQL_JSON_TWO_BINDINGS = JSON.stringify({
  head: { vars: ['s', 'p', 'o'] },
  results: {
    bindings: [
      {
        s: { type: 'uri', value: 'http://example.org/keep' },
        p: { type: 'uri', value: 'http://example.org/p' },
        o: { type: 'uri', value: 'http://example.org/v1' },
      },
      {
        s: { type: 'uri', value: 'http://example.org/drop' },
        p: { type: 'uri', value: 'http://example.org/p' },
        o: { type: 'uri', value: 'http://example.org/v2' },
      },
    ],
  },
});

const SPARQL_JSON_KEEP_ONLY = JSON.stringify({
  head: { vars: ['s', 'p', 'o'] },
  results: {
    bindings: [
      {
        s: { type: 'uri', value: 'http://example.org/keep' },
        p: { type: 'uri', value: 'http://example.org/p' },
        o: { type: 'uri', value: 'http://example.org/v1' },
      },
    ],
  },
});

function endpointSource(url: string): ParsedEndpointSource {
  return parseSourceSpecs([
    { id: 'live', endpoint: url },
  ])[0] as ParsedEndpointSource;
}

describe('resolveViewPassThrough', () => {
  let endpoint: FakeSparqlEndpoint | undefined;

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
  });

  it('forwards the view query verbatim to the endpoint and returns the result as a Store', async () => {
    const captured: string[] = [];
    endpoint = await startFakeSparqlEndpoint(({ query }) => {
      captured.push(query);
      return { body: SPARQL_JSON_KEEP_ONLY };
    });

    const VIEW_QUERY =
      'PREFIX ex: <http://example.org/> SELECT ?s ?p ?o WHERE { ?s ?p ?o FILTER(?s = ex:keep) }';

    const store = await resolveViewPassThrough({
      endpoint: endpointSource(endpoint.url),
      viewQuery: VIEW_QUERY,
    });

    expect(captured.length).toBeGreaterThan(0);
    expect(captured.some((q) => q.includes('FILTER'))).toBe(true);
    expect(
      captured.every(
        (q) => !/\bSELECT\s+\?s\s+\?p\s+\?o\s+WHERE\s*{\s*\?s\s+\?p\s+\?o\s*}\s*$/i.test(q),
      ),
    ).toBe(true);
    const subjects = store
      .getQuads(null, null, null, null)
      .map((q) => q.subject.value);
    expect(subjects).toEqual(['http://example.org/keep']);
  });

  it('forwards bearer auth from the endpoint source as `Authorization: Bearer <token>`', async () => {
    let observedAuth: string | undefined;
    endpoint = await startFakeSparqlEndpoint(({ headers }) => {
      const v = headers['authorization'];
      observedAuth = Array.isArray(v) ? v[0] : v;
      return { body: SPARQL_JSON_TWO_BINDINGS };
    });
    const source = parseSourceSpecs([
      {
        id: 'live',
        endpoint: endpoint.url,
        auth: { type: 'bearer', token: 'tk-1' },
      },
    ])[0] as ParsedEndpointSource;

    await resolveViewPassThrough({
      endpoint: source,
      viewQuery: 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }',
    });

    expect(observedAuth).toBe('Bearer tk-1');
  });

  it('forwards custom headers from the endpoint source verbatim', async () => {
    let observed: Record<string, string | string[] | undefined> = {};
    endpoint = await startFakeSparqlEndpoint(({ headers }) => {
      observed = headers;
      return { body: SPARQL_JSON_TWO_BINDINGS };
    });
    const source = parseSourceSpecs([
      {
        id: 'live',
        endpoint: endpoint.url,
        headers: { 'X-Tenant': 'acme' },
      },
    ])[0] as ParsedEndpointSource;

    await resolveViewPassThrough({
      endpoint: source,
      viewQuery: 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }',
    });

    const tenant = observed['x-tenant'];
    expect(Array.isArray(tenant) ? tenant[0] : tenant).toBe('acme');
  });

  it('honours `timeoutMs` on the endpoint source (slow endpoint surfaces a hard error)', async () => {
    endpoint = await startFakeSparqlEndpoint(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { body: SPARQL_JSON_TWO_BINDINGS };
    });
    const source = parseSourceSpecs([
      {
        id: 'live',
        endpoint: endpoint.url,
        timeoutMs: 25,
      },
    ])[0] as ParsedEndpointSource;

    await expect(
      resolveViewPassThrough({
        endpoint: source,
        viewQuery: 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }',
      }),
    ).rejects.toThrow(/endpoint .*:/);
  });

  it('builds a Store from a CONSTRUCT (quads) result type', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'text/turtle',
      body:
        '@prefix ex: <http://example.org/> .\n' +
        'ex:keep ex:p ex:v1 .\n',
    }));

    const store = await resolveViewPassThrough({
      endpoint: endpointSource(endpoint.url),
      viewQuery:
        'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
    });

    const subjects = store
      .getQuads(null, null, null, null)
      .map((q) => q.subject.value)
      .sort();
    expect(subjects).toEqual(['http://example.org/keep']);
  });

  it('wraps endpoint errors with the `endpoint <url>: <message>` prefix', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      status: 500,
      contentType: 'text/plain',
      body: 'boom',
    }));
    const source = endpointSource(endpoint.url);

    await expect(
      resolveViewPassThrough({
        endpoint: source,
        viewQuery: 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }',
      }),
    ).rejects.toThrow(new RegExp(`^endpoint ${escapeRegExp(source.endpoint)}:`));
  });
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
