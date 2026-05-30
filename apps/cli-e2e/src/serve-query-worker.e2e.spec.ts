import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServe, type ServeHandle } from './helpers/serve';

/**
 * ADR-0050 (#385): in-memory materialized queries run off the main event loop
 * in a real `worker_thread`. These e2e tests boot the built CLI's `serve` — so
 * the worker is a genuine thread — and prove (1) results round-trip correctly
 * across the `MessagePort` and (2) a CPU-heavy query in the worker does not
 * block a concurrent request handled on the main loop.
 */
describe('sparqly serve — off-main-thread in-memory queries (ADR-0050)', () => {
  let dir: string;
  let handle: ServeHandle | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-serve-worker-'));
  });

  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  async function writeConfig(triples: number): Promise<string> {
    const dataPath = join(dir, 'data.ttl');
    const lines = ['@prefix ex: <http://example.org/> .'];
    for (let i = 0; i < triples; i++) lines.push(`ex:s${i} ex:p ex:o${i} .`);
    await writeFile(dataPath, lines.join('\n') + '\n');
    const configPath = join(dir, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: data
            default: true
            glob: "${dataPath}"
      ` + '\n',
    );
    return configPath;
  }

  /** Two materialized sources pinned to one worker (`query.concurrency: 1`)
   * under a resident budget too small to hold both — so touching one evicts the
   * other. */
  async function writeEvictionConfig(): Promise<string> {
    for (const [id, n] of [
      ['alpha', 3],
      ['beta', 4],
    ] as const) {
      const lines = ['@prefix ex: <http://example.org/> .'];
      for (let i = 0; i < n; i++) lines.push(`ex:${id}${i} ex:p ex:o${i} .`);
      await writeFile(join(dir, `${id}.ttl`), lines.join('\n') + '\n');
    }
    const configPath = join(dir, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        query:
          concurrency: 1
          maxResidentQuads: 5
        sources:
          - id: alpha
            glob: "${join(dir, 'alpha.ttl')}"
          - id: beta
            glob: "${join(dir, 'beta.ttl')}"
      ` + '\n',
    );
    return configPath;
  }

  it('transparently rebuilds an evicted store under a low resident budget', async () => {
    // alpha(3) + beta(4) = 7 quads > budget 5, and both pin to the single
    // worker, so each touch evicts the other. Alternating queries force the
    // worker to rebuild from its retained recipe every time, off the main loop.
    const configPath = await writeEvictionConfig();
    handle = await startServe(['--config', configPath]);

    const count = async (id: string): Promise<string> => {
      const res = await fetch(
        `${handle!.baseUrl}/api/sparql/${id}?query=${encodeURIComponent(
          'SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }',
        )}`,
        { headers: { accept: 'application/sparql-results+json' } },
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        results: { bindings: Array<{ n: { value: string } }> };
      };
      return json.results.bindings[0].n.value;
    };

    // Each source keeps returning its own correct count across repeated
    // cross-eviction — the rebuild is invisible to the client.
    for (let round = 0; round < 3; round++) {
      expect(await count('alpha')).toBe('3');
      expect(await count('beta')).toBe('4');
    }
  });

  it('returns a correct in-memory query result across the worker boundary', async () => {
    const configPath = await writeConfig(3);
    handle = await startServe(['--config', configPath, '--verbose']);

    const res = await fetch(
      `${handle.baseUrl}/api/sparql/data?query=${encodeURIComponent(
        'SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }',
      )}`,
      { headers: { accept: 'application/sparql-results+json' } },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      results: { bindings: Array<{ n: { value: string } }> };
    };
    expect(json.results.bindings[0].n.value).toBe('3');

    // The worker hosts the build, so first-touch load logging still fires.
    expect(handle.stderr()).toMatch(
      /source-loaded .*\bsource=data\b.*\bquads=3\b/,
    );
  });

  it('reclaims a single worker when an abandoned heavy query is disconnected, then serves the next query', async () => {
    // One source pinned to one worker. A 4-way cross join over ~120 triples is a
    // multi-minute synchronous Comunica stretch — effectively a hang. Without
    // cancellation it would occupy the sole worker indefinitely, so the next
    // query could never be answered. Hybrid cancellation must reclaim the worker.
    const dataPath = join(dir, 'data.ttl');
    const lines = ['@prefix ex: <http://example.org/> .'];
    for (let i = 0; i < 120; i++) lines.push(`ex:s${i} ex:p ex:o${i} .`);
    await writeFile(dataPath, lines.join('\n') + '\n');
    const configPath = join(dir, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        query:
          concurrency: 1
        sources:
          - id: data
            default: true
            glob: "${dataPath}"
      ` + '\n',
    );
    handle = await startServe(['--config', configPath]);
    const base = handle.baseUrl;

    // Warm the store so the disconnect targets a CPU-bound query, not the load.
    await (
      await fetch(`${base}/api/sparql/data?query=${encodeURIComponent('ASK { ?s ?p ?o }')}`)
    ).arrayBuffer();

    const heavy =
      'SELECT (COUNT(*) AS ?n) WHERE { ?a ?b ?c . ?d ?e ?f . ?g ?h ?i . ?j ?k ?l }';
    const ac = new AbortController();
    const abandoned = fetch(
      `${base}/api/sparql/data?query=${encodeURIComponent(heavy)}`,
      { signal: ac.signal },
    );
    abandoned.catch(() => undefined); // the abort rejects this; swallow it.

    // Let the worker enter its synchronous stretch, then disconnect the client.
    await new Promise((r) => setTimeout(r, 150));
    ac.abort();
    await expect(abandoned).rejects.toThrow();

    // The worker is reclaimed and the store rebuilt, so the next query against
    // the same sticky source is answered correctly rather than hanging.
    const res = await fetch(
      `${base}/api/sparql/data?query=${encodeURIComponent(
        'SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }',
      )}`,
      { headers: { accept: 'application/sparql-results+json' } },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      results: { bindings: Array<{ n: { value: string } }> };
    };
    expect(json.results.bindings[0].n.value).toBe('120');
  }, 60_000);

  it('does not block a concurrent request while a heavy query runs in the worker', async () => {
    // ~130 triples → a 3-way cross join enumerates ~2.2M solutions, several
    // seconds of synchronous Comunica CPU — the exact "one query freezes
    // everything" case, sized to stay well under the timeout under suite load.
    const configPath = await writeConfig(130);
    handle = await startServe(['--config', configPath]);
    const base = handle.baseUrl;

    // Warm the store first so the slow request times pure query CPU, not load.
    await (await fetch(`${base}/api/sparql/data?query=${encodeURIComponent('ASK { ?s ?p ?o }')}`)).arrayBuffer();

    const heavy =
      'SELECT (COUNT(*) AS ?n) WHERE { ?a ?b ?c . ?d ?e ?f . ?g ?h ?i }';
    const slowStart = Date.now();
    const slow = fetch(
      `${base}/api/sparql/data?query=${encodeURIComponent(heavy)}`,
    ).then(async (r) => {
      await r.arrayBuffer();
      return { who: 'slow' as const, ms: Date.now() - slowStart, status: r.status };
    });

    // Let the worker enter its synchronous stretch before racing the cheap call.
    await new Promise((r) => setTimeout(r, 100));

    const cfgStart = Date.now();
    const config = fetch(`${base}/api/config`).then(async (r) => {
      await r.arrayBuffer();
      return { who: 'config' as const, ms: Date.now() - cfgStart, status: r.status };
    });

    // If the heavy query were on the main loop, /api/config could not return
    // until it finished. Isolation means the cheap call wins, and fast.
    const winner = await Promise.race([slow, config]);
    expect(winner.who).toBe('config');

    const cfgResult = await config;
    expect(cfgResult.status).toBe(200);
    expect(cfgResult.ms).toBeLessThan(1000);

    const slowResult = await slow;
    expect(slowResult.status).toBe(200);
  }, 60_000);
});
