import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';
import { startServe, type ServeHandle } from './helpers/serve';

const SPARQL_JSON = JSON.stringify({
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

/**
 * End-to-end coverage for the observable serve path of the Query cache
 * (ADR-0054, #413): an opted-in endpoint served over HTTP reports
 * `X-Sparqly-Cache: miss` on the first request and `hit` on an identical repeat,
 * and the repeat issues no new upstream round-trip.
 */
describe('sparqly serve — endpoint Query cache header (#413)', () => {
  let endpoint: FakeSparqlEndpoint | undefined;
  let handle: ServeHandle | undefined;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-serve-cache-'));
    // A `.git` boundary stops config auto-discovery walking onto the host.
    await mkdir(join(dir, '.git'));
  });

  afterEach(async () => {
    if (handle) await handle.close();
    if (endpoint) await endpoint.close();
    handle = undefined;
    endpoint = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('reports miss then hit via X-Sparqly-Cache and skips the second round-trip', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON,
    }));
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      dedent`
        sources:
          - id: live
            endpoint: ${endpoint.url}
            queryCache: true
            default: true
      ` + '\n',
    );

    handle = await startServe([], { cwd: dir });

    const probe = 'SELECT ?s WHERE { ?s ?p <urn:my:serve-cache-probe> }';
    const url = `${handle.baseUrl}/api/sparql?query=${encodeURIComponent(probe)}`;

    const first = await fetch(url);
    await first.arrayBuffer();
    expect(first.status).toBe(200);
    expect(first.headers.get('x-sparqly-cache')).toBe('miss');
    const afterFirst = endpoint.requestCount();

    const second = await fetch(url);
    await second.arrayBuffer();
    expect(second.status).toBe(200);
    expect(second.headers.get('x-sparqly-cache')).toBe('hit');

    // The hit answered without a fresh upstream request.
    expect(endpoint.requestCount()).toBe(afterFirst);
  });
});
