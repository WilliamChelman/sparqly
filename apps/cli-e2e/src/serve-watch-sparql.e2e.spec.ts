import { afterEach, describe, expect, it } from 'vitest';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';
import { startServe, type ServeHandle } from './helpers/serve';

const SPARQL_JSON_ONE_BINDING = JSON.stringify({
  head: { vars: ['s', 'p', 'o'] },
  results: {
    bindings: [
      {
        s: { type: 'uri', value: 'http://example.org/remote' },
        p: { type: 'uri', value: 'http://example.org/p' },
        o: { type: 'uri', value: 'http://example.org/v' },
      },
    ],
  },
});

const SELECT_ALL = 'SELECT * WHERE { ?s ?p ?o }';

describe('sparqly serve --watch with no glob source (SPARQL-only)', () => {
  let endpoint: FakeSparqlEndpoint | undefined;
  let handle: ServeHandle | undefined;

  afterEach(async () => {
    if (handle) await handle.close();
    if (endpoint) await endpoint.close();
    endpoint = undefined;
    handle = undefined;
  });

  it('warns and proceeds without watching (US 40)', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON_ONE_BINDING,
    }));

    handle = await startServe([endpoint.url, '--watch']);

    expect(handle.stderr()).toMatch(/--watch/);
    expect(handle.stderr()).toMatch(/no glob source/i);
    expect(handle.stderr()).not.toMatch(/Watching for changes/);

    const res = await fetch(
      `${handle.baseUrl}/api/sparql?query=${encodeURIComponent(SELECT_ALL)}`,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results.bindings.length).toBeGreaterThan(0);
  });
});

