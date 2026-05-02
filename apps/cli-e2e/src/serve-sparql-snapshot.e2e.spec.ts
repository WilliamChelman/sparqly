import { afterEach, describe, expect, it } from 'vitest';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';
import { startServe, type ServeHandle } from './helpers/serve';

const SPARQL_JSON_THREE = JSON.stringify({
  head: { vars: ['s', 'p', 'o'] },
  results: {
    bindings: [
      {
        s: { type: 'uri', value: 'http://example.org/a' },
        p: { type: 'uri', value: 'http://example.org/p' },
        o: { type: 'uri', value: 'http://example.org/b' },
      },
      {
        s: { type: 'uri', value: 'http://example.org/a' },
        p: { type: 'uri', value: 'http://example.org/q' },
        o: { type: 'uri', value: 'http://example.org/c' },
      },
      {
        s: { type: 'uri', value: 'http://example.org/d' },
        p: { type: 'uri', value: 'http://example.org/p' },
        o: { type: 'uri', value: 'http://example.org/e' },
      },
    ],
  },
});

const SELECT_ALL = 'SELECT * WHERE { ?s ?p ?o }';

describe('sparqly serve — SPARQL source materialized snapshot (US 47)', () => {
  let endpoint: FakeSparqlEndpoint | undefined;
  let handle: ServeHandle | undefined;

  afterEach(async () => {
    if (handle) await handle.close();
    if (endpoint) await endpoint.close();
    endpoint = undefined;
    handle = undefined;
  });

  it('loads the SPARQL source at boot and serves further queries from memory without re-querying the upstream', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON_THREE,
    }));

    handle = await startServe([endpoint.url]);

    const afterBoot = endpoint.requestCount();
    expect(afterBoot).toBeGreaterThan(0);

    for (let i = 0; i < 3; i++) {
      const res = await fetch(
        `${handle.baseUrl}/api/sparql?query=${encodeURIComponent(SELECT_ALL)}`,
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      const subjects = (
        json.results.bindings as Array<{ s: { value: string } }>
      ).map((b) => b.s.value);
      expect(subjects).toContain('http://example.org/a');
      expect(subjects).toContain('http://example.org/d');
    }

    expect(endpoint.requestCount()).toBe(afterBoot);
  });

  it('exposes no /api/refresh endpoint', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON_THREE,
    }));

    handle = await startServe([endpoint.url]);

    for (const method of ['GET', 'POST'] as const) {
      const res = await fetch(`${handle.baseUrl}/api/refresh`, { method });
      expect(res.status).toBe(404);
    }
  });
});
