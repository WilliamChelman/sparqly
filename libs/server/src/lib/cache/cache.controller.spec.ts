import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CreatedServer } from '../bootstrap';
import { createTestServer } from '../bootstrap/create-test-server';

const SAMPLE = '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n';
const PROBE = 'SELECT ?s WHERE { ?s ?p ?o }';

/**
 * The `cache clear` admin action over HTTP (ADR-0054, #418), driven through
 * the public surface: clearing the serve Query cache makes a previously-hit
 * query recompute. Only this action is gated by `--read-only` — caching
 * reads/writes themselves operate normally there (the cache is not a project
 * file).
 */
describe('CacheController — POST /api/cache/clear (ADR-0054, #418)', () => {
  let dataDir: string;
  let cfgDir: string;
  let server: CreatedServer | undefined;

  beforeEach(async () => {
    Logger.overrideLogger(false);
    dataDir = await mkdtemp(join(tmpdir(), 'sparqly-cache-clear-data-'));
    cfgDir = await mkdtemp(join(tmpdir(), 'sparqly-cache-clear-cfg-'));
    await writeFile(join(dataDir, 'a.ttl'), SAMPLE);
  });

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
    await rm(dataDir, { recursive: true, force: true });
    await rm(cfgDir, { recursive: true, force: true });
  });

  async function boot(options: { readOnly?: boolean } = {}): Promise<{
    queryUrl: string;
    clearUrl: string;
  }> {
    server = await createTestServer({
      sources: [
        {
          id: 'alpha',
          glob: join(dataDir, '*.ttl'),
          queryCache: true,
          default: true,
        },
      ],
      port: 0,
      configDir: cfgDir,
      readOnly: options.readOnly,
    });
    const base = `http://localhost:${server.port}/api`;
    return {
      queryUrl: `${base}/sparql?query=${encodeURIComponent(PROBE)}`,
      clearUrl: `${base}/cache/clear`,
    };
  }

  async function cacheStatus(url: string): Promise<string | null> {
    const resp = await fetch(url);
    await resp.arrayBuffer();
    expect(resp.status).toBe(200);
    return resp.headers.get('x-sparqly-cache');
  }

  it('clears the Query cache: a previously-hit query recomputes', async () => {
    const { queryUrl, clearUrl } = await boot();

    expect(await cacheStatus(queryUrl)).toBe('miss');
    expect(await cacheStatus(queryUrl)).toBe('hit');

    const cleared = await fetch(clearUrl, { method: 'POST' });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ cleared: true });

    expect(await cacheStatus(queryUrl)).toBe('miss');
  });

  it('refuses clear under read-only (403), while caching itself still operates', async () => {
    const { queryUrl, clearUrl } = await boot({ readOnly: true });

    // Reads/writes are not gated: the cache is not a project file (ADR-0054).
    expect(await cacheStatus(queryUrl)).toBe('miss');
    expect(await cacheStatus(queryUrl)).toBe('hit');

    const refused = await fetch(clearUrl, { method: 'POST' });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({
      error: 'admin-actions-disabled',
    });

    // Nothing was cleared — the entry still answers.
    expect(await cacheStatus(queryUrl)).toBe('hit');
  });
});
