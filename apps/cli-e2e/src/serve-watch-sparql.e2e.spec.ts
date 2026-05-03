import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';
import { queryFixture } from './helpers/fixtures';
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
const SELECT_NAMES =
  'SELECT ?name WHERE { ?s <http://example.org/name> ?name } ORDER BY ?name';

async function eventually(
  fn: () => Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

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

describe('sparqly serve --watch with mixed glob and SPARQL sources', () => {
  let endpoint: FakeSparqlEndpoint | undefined;
  let handle: ServeHandle | undefined;
  let scratch: string;
  let dataPath: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-watch-mixed-'));
    dataPath = join(scratch, 'data.ttl');
    await copyFile(queryFixture('people.ttl'), dataPath);
  });

  afterEach(async () => {
    if (handle) await handle.close();
    if (endpoint) await endpoint.close();
    endpoint = undefined;
    handle = undefined;
    await rm(scratch, { recursive: true, force: true });
  });

  it('rebuild re-runs the full pipeline including re-querying the SPARQL endpoint', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON_ONE_BINDING,
    }));

    const configPath = join(scratch, 'sparqly.serve.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - "${dataPath}"
          - id: ep
            endpoint: "${endpoint.url}"
          - id: snap
            from: "@ep"
            query: "SELECT ?s ?p ?o WHERE { ?s ?p ?o }"
      ` + '\n',
    );

    handle = await startServe([
      '--config',
      configPath,
      '--watch',
      '--watch-debounce',
      '100',
    ]);

    const initialEndpointCount = endpoint.requestCount();
    expect(initialEndpointCount).toBeGreaterThan(0);

    // Sanity: remote subject is visible through the merged store.
    const before = await fetch(
      `${handle.baseUrl}/api/sparql?query=${encodeURIComponent(
        'SELECT ?s WHERE { ?s ?p ?o } ORDER BY ?s',
      )}`,
    );
    const beforeJson = await before.json();
    const beforeSubjects = beforeJson.results.bindings.map(
      (b: { s: { value: string } }) => b.s.value,
    );
    expect(beforeSubjects).toContain('http://example.org/remote');

    // Edit the local file to add a new name.
    await writeFile(
      dataPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:dave ex:name "Dave" .
      ` + '\n',
    );

    await eventually(async () => {
      const res = await fetch(
        `${handle?.baseUrl}/api/sparql?query=${encodeURIComponent(
          SELECT_NAMES,
        )}`,
      );
      const j = await res.json();
      const names: string[] = j.results.bindings.map(
        (b: { name: { value: string } }) => b.name.value,
      );
      return names.includes('Dave');
    });

    expect(endpoint.requestCount()).toBeGreaterThan(initialEndpointCount);
  });
});
