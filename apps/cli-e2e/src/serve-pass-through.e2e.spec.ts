import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';
import { runCli } from './helpers/run-cli';
import { startServe, type ServeHandle } from './helpers/serve';

const SPARQL_JSON_PROBE = JSON.stringify({
  head: { vars: ['s', 'p', 'o'] },
  results: {
    bindings: [
      {
        s: { type: 'uri', value: 'http://example.org/a' },
        p: { type: 'uri', value: 'http://example.org/p' },
        o: { type: 'uri', value: 'http://example.org/b' },
      },
    ],
  },
});

describe('sparqly serve — pass-through federation', () => {
  let endpoint: FakeSparqlEndpoint | undefined;
  let handle: ServeHandle | undefined;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-serve-pt-e2e-'));
  });

  afterEach(async () => {
    if (handle) await handle.close();
    if (endpoint) await endpoint.close();
    handle = undefined;
    endpoint = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('forwards user queries to the upstream endpoint via Comunica federation (no boot-time materialization)', async () => {
    const captured: string[] = [];
    endpoint = await startFakeSparqlEndpoint(({ query }) => {
      captured.push(query);
      return {
        contentType: 'application/sparql-results+json',
        body: SPARQL_JSON_PROBE,
      };
    });

    handle = await startServe([endpoint.url]);

    // No boot-time materialization: the snapshot path would have issued a
    // SELECT * before any user query, but pass-through must not.
    expect(
      captured.every(
        (q) =>
          !/\bSELECT\s+\?s\s+\?p\s+\?o\s+WHERE\s*{\s*\?s\s+\?p\s+\?o\s*}\s*$/i.test(
            q,
          ),
      ),
    ).toBe(true);

    const probeQuery =
      'SELECT ?s WHERE { ?s ?p <urn:my:serve-pt-probe> }';
    const res = await fetch(
      `${handle.baseUrl}/api/sparql?query=${encodeURIComponent(probeQuery)}`,
    );
    expect(res.status).toBe(200);

    expect(captured.length).toBeGreaterThan(0);
    expect(captured.some((q) => q.includes('urn:my:serve-pt-probe'))).toBe(
      true,
    );
  });

  it('mixing an endpoint without prefilter and a glob source is rejected at startup', async () => {
    let requestCount = 0;
    endpoint = await startFakeSparqlEndpoint(() => {
      requestCount += 1;
      return {
        contentType: 'application/sparql-results+json',
        body: SPARQL_JSON_PROBE,
      };
    });
    const ttlPath = join(dir, 'a.ttl');
    await writeFile(
      ttlPath,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const configPath = join(dir, 'sparqly.serve.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - "${endpoint.url}"
          - "${ttlPath}"
      ` + '\n',
    );

    const result = await runCli(['serve', '--config', configPath, '--port', '0'], {
      env: {},
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/endpoint.*prefilter/i);
    expect(requestCount).toBe(0);
  });
});
