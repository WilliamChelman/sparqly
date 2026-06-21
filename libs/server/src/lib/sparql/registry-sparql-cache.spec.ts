import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CreatedServer } from '../bootstrap';
import { createTestServer } from '../bootstrap/create-test-server';

/**
 * Serve-side Query cache controls (ADR-0054, #418), driven through the public
 * HTTP surface against an opted-in endpoint source backed by a fake upstream
 * whose answer can change between executions — so a refresh's "recompute and
 * replace" is observable from the response body alone.
 */

function sparqlJson(value: string): string {
  return JSON.stringify({
    head: { vars: ['s'] },
    results: { bindings: [{ s: { type: 'uri', value } }] },
  });
}

interface FakeUpstream {
  url: string;
  calls(): number;
  setAnswer(value: string): void;
  close(): Promise<void>;
}

/** A stub SPARQL endpoint answering every request with the current binding. */
async function startFakeUpstream(initial: string): Promise<FakeUpstream> {
  let calls = 0;
  let answer = initial;
  const server: Server = createHttpServer((_req, res) => {
    calls++;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/sparql-results+json');
    res.end(sparqlJson(answer));
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', resolve),
  );
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/sparql`,
    calls: () => calls,
    setAnswer: (value) => {
      answer = value;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

const PROBE = 'SELECT ?s WHERE { ?s ?p <urn:my:refresh-probe> }';

describe('serve — per-request Query cache refresh (ADR-0054, #418)', () => {
  let cfgDir: string;
  let upstream: FakeUpstream | undefined;
  let server: CreatedServer | undefined;

  beforeEach(async () => {
    Logger.overrideLogger(false);
    cfgDir = await mkdtemp(join(tmpdir(), 'sparqly-cache-refresh-'));
  });

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
    if (upstream) await upstream.close();
    upstream = undefined;
    await rm(cfgDir, { recursive: true, force: true });
  });

  async function bootCachedEndpoint(): Promise<{
    url: string;
    up: FakeUpstream;
  }> {
    const up = await startFakeUpstream('http://example.org/OLD');
    upstream = up;
    server = await createTestServer({
      sources: [
        {
          id: 'live',
          endpoint: up.url,
          queryCache: true,
          default: true,
        },
      ],
      port: 0,
      configDir: cfgDir,
    });
    return {
      url: `http://localhost:${server.port}/api/sparql?query=${encodeURIComponent(
        PROBE,
      )}`,
      up,
    };
  }

  it('Cache-Control: no-cache recomputes and replaces the cached entry', async () => {
    const { url, up } = await bootCachedEndpoint();

    // Warm the cache: miss, then hit without a new upstream round-trip.
    const warm = await fetch(url);
    expect(warm.status).toBe(200);
    expect(warm.headers.get('x-sparqly-cache')).toBe('miss');
    expect(await warm.text()).toContain('http://example.org/OLD');
    const afterWarm = up.calls();
    const hit = await fetch(url);
    expect(hit.headers.get('x-sparqly-cache')).toBe('hit');
    expect(up.calls()).toBe(afterWarm);

    // The upstream answer changes; a per-request refresh must see it.
    up.setAnswer('http://example.org/NEW');
    const refreshed = await fetch(url, {
      headers: { 'cache-control': 'no-cache' },
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.get('x-sparqly-cache')).toBe('miss');
    expect(await refreshed.text()).toContain('http://example.org/NEW');
    expect(up.calls()).toBeGreaterThan(afterWarm);

    // The refresh replaced the stored entry: a normal request now hits NEW.
    const afterRefresh = up.calls();
    const after = await fetch(url);
    expect(after.headers.get('x-sparqly-cache')).toBe('hit');
    expect(await after.text()).toContain('http://example.org/NEW');
    expect(up.calls()).toBe(afterRefresh);
  });

  it('Cache-Control: no-store bypasses the cache — no read, no write', async () => {
    const { url, up } = await bootCachedEndpoint();

    // Warm the cache so there is a stored entry that a bypass must ignore.
    const warm = await fetch(url);
    expect(warm.status).toBe(200);
    expect(warm.headers.get('x-sparqly-cache')).toBe('miss');
    expect(await warm.text()).toContain('http://example.org/OLD');
    const afterWarm = up.calls();

    // The upstream answer changes; a no-store request must not be served the
    // stored hit, and must not be tagged as a hit.
    up.setAnswer('http://example.org/NEW');
    const bypass = await fetch(url, {
      headers: { 'cache-control': 'no-store' },
    });
    expect(bypass.status).toBe(200);
    expect(bypass.headers.get('x-sparqly-cache')).toBe('bypass');
    expect(await bypass.text()).toContain('http://example.org/NEW');
    expect(up.calls()).toBeGreaterThan(afterWarm);

    // The bypass did not write: a normal request still hits the original entry.
    const afterBypass = up.calls();
    const after = await fetch(url);
    expect(after.headers.get('x-sparqly-cache')).toBe('hit');
    expect(await after.text()).toContain('http://example.org/OLD');
    expect(up.calls()).toBe(afterBypass);
  });
});
