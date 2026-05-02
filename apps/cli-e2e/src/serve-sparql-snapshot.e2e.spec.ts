import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-serve-snap-'));
  });

  afterEach(async () => {
    if (handle) await handle.close();
    if (endpoint) await endpoint.close();
    endpoint = undefined;
    handle = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  async function startWithPrefilter(): Promise<void> {
    const configPath = join(dir, 'sparqly.serve.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - endpoint: "${endpoint?.url}"
            prefilter: "SELECT ?s ?p ?o WHERE { ?s ?p ?o }"
      ` + '\n',
    );
    handle = await startServe(['--config', configPath]);
  }

  it('loads the SPARQL source at boot and serves further queries from memory without re-querying the upstream', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON_THREE,
    }));

    await startWithPrefilter();

    const afterBoot = endpoint.requestCount();
    expect(afterBoot).toBeGreaterThan(0);

    for (let i = 0; i < 3; i++) {
      const res = await fetch(
        `${handle?.baseUrl}/api/sparql?query=${encodeURIComponent(SELECT_ALL)}`,
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

    await startWithPrefilter();

    for (const method of ['GET', 'POST'] as const) {
      const res = await fetch(`${handle?.baseUrl}/api/refresh`, { method });
      expect(res.status).toBe(404);
    }
  });
});
