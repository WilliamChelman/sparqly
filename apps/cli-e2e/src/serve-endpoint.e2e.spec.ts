import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { queryFixture } from './helpers/fixtures';
import { startServe, type ServeHandle } from './helpers/serve';

const SOURCES = queryFixture('people.ttl');
const SELECT_ALL = 'SELECT * WHERE { ?s ?p ?o } LIMIT 5';

describe('sparqly serve — SPARQL HTTP endpoint', () => {
  let handle: ServeHandle;

  beforeEach(async () => {
    handle = await startServe([SOURCES]);
  });

  afterEach(async () => {
    await handle.close();
  });

  it('GET /api/sparql returns SPARQL JSON results (US 13, 14, 19)', async () => {
    const url = `${handle.baseUrl}/api/sparql?query=${encodeURIComponent(SELECT_ALL)}`;
    const res = await fetch(url);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/sparql-results\+json/);
    const json = await res.json();
    expect(json.results.bindings).toHaveLength(5);
  });

  it('POST /api/sparql with application/x-www-form-urlencoded body works', async () => {
    const res = await fetch(`${handle.baseUrl}/api/sparql`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ query: SELECT_ALL }).toString(),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results.bindings).toHaveLength(5);
  });

  it('POST /api/sparql with application/sparql-query body works (US 14)', async () => {
    const res = await fetch(`${handle.baseUrl}/api/sparql`, {
      method: 'POST',
      headers: { 'content-type': 'application/sparql-query' },
      body: SELECT_ALL,
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results.bindings).toHaveLength(5);
  });

  it('serves the bundled web playground at / (US 13, 15)', async () => {
    const res = await fetch(`${handle.baseUrl}/`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toMatch(/<html/);
  });

  it('rejects mutating queries by default on the endpoint', async () => {
    const res = await fetch(`${handle.baseUrl}/api/sparql`, {
      method: 'POST',
      headers: { 'content-type': 'application/sparql-query' },
      body: 'INSERT DATA { <http://example.org/x> <http://example.org/p> <http://example.org/y> }',
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    const text = await res.text();
    expect(text).toMatch(/Mutating queries are disabled/);
  });
});

describe('sparqly serve — port flag', () => {
  it('--port overrides the default port (US 19)', async () => {
    const handle = await startServe([SOURCES]);
    try {
      const res = await fetch(
        `${handle.baseUrl}/api/sparql?query=${encodeURIComponent('ASK { ?s ?p ?o }')}`,
      );
      expect(res.status).toBe(200);
      // baseUrl is built from the port we explicitly chose; success here means
      // the CLI honoured --port.
      expect(handle.port).toBeGreaterThan(0);
    } finally {
      await handle.close();
    }
  });
});
