import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';
import { runCli } from './helpers/run-cli';

const CLEARED_ENV = {
  SPARQLY_CONFIG: undefined,
  SPARQLY_VERBOSE: undefined,
  SPARQLY_QUIET: undefined,
} as const;

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
 * End-to-end coverage for the CLI control surface over the Query cache
 * (ADR-0054, #417): the `--no-cache` / `--refresh` flags and the `cache
 * clear` / `cache stats` lifecycle commands. The proof is a request-counting
 * fake endpoint — a cache hit is a run that issues no new remote round-trip.
 */
describe('sparqly query — Query cache controls (#417)', () => {
  let projectRoot: string;
  let endpoint: FakeSparqlEndpoint | undefined;

  beforeEach(async () => {
    projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'sparqly-cache-controls-')),
    );
    // A `.git` boundary stops config auto-discovery from walking onto the host.
    await mkdir(join(projectRoot, '.git'));
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON,
    }));
    await writeFile(
      join(projectRoot, 'sparqly.config.yaml'),
      dedent`
        sources:
          - id: live
            endpoint: ${endpoint.url}
            queryCache: true
      ` + '\n',
    );
  });

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
    await rm(projectRoot, { recursive: true, force: true });
  });

  const QUERY = ['query', '@live', '-q', 'SELECT ?s WHERE { ?s ?p ?o }'];

  function run(args: string[]) {
    return runCli(args, { cwd: projectRoot, env: CLEARED_ENV });
  }

  async function exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  const cacheDir = () => join(projectRoot, '.sparqly', 'cache');

  it('--no-cache neither reads nor writes the cache, leaving the store untouched', async () => {
    const first = await run([...QUERY, '--no-cache']);
    expect(first.exitCode).toBe(0);
    const afterFirst = endpoint!.requestCount();
    expect(afterFirst).toBeGreaterThan(0);

    const second = await run([...QUERY, '--no-cache']);
    expect(second.exitCode).toBe(0);

    // Both runs went to the endpoint; the cache directory was never created.
    expect(endpoint!.requestCount()).toBeGreaterThan(afterFirst);
    expect(await exists(cacheDir())).toBe(false);
  });

  it('--refresh recomputes and replaces the cached entry', async () => {
    const first = await run(QUERY);
    expect(first.exitCode).toBe(0);
    const afterWarm = endpoint!.requestCount();

    // A normal repeat is a hit — no new round-trip.
    await run(QUERY);
    expect(endpoint!.requestCount()).toBe(afterWarm);

    // --refresh ignores the hit and recomputes.
    const refreshed = await run([...QUERY, '--refresh']);
    expect(refreshed.exitCode).toBe(0);
    const afterRefresh = endpoint!.requestCount();
    expect(afterRefresh).toBeGreaterThan(afterWarm);

    // The recomputed result replaced the entry: the next normal run hits again.
    await run(QUERY);
    expect(endpoint!.requestCount()).toBe(afterRefresh);
  });

  it('cache stats reports entry count, bytes, and a per-source breakdown', async () => {
    const warm = await run(QUERY);
    expect(warm.exitCode).toBe(0);

    const stats = await run(['cache', 'stats']);
    expect(stats.exitCode).toBe(0);
    expect(stats.stdout).toContain('entries\t1');
    expect(stats.stdout).toMatch(/bytes\t[1-9]\d*/);
    // The opted-in source `live` owns the single entry.
    expect(stats.stdout).toMatch(/source\tlive\t1\t[1-9]\d*/);
  });

  it('cache clear empties the store so the next query recomputes', async () => {
    const warm = await run(QUERY);
    expect(warm.exitCode).toBe(0);
    const afterWarm = endpoint!.requestCount();

    const cleared = await run(['cache', 'clear']);
    expect(cleared.exitCode).toBe(0);
    expect(cleared.stdout).toContain('cleared 1 entries');

    // Emptied: the next normal query misses and issues a fresh round-trip.
    await run(QUERY);
    expect(endpoint!.requestCount()).toBeGreaterThan(afterWarm);

    // And the store is empty again.
    const stats = await run(['cache', 'stats']);
    expect(stats.stdout).toContain('entries\t1');
  });
});
