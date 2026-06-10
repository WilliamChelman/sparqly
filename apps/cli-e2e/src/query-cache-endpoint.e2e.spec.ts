import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
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
 * End-to-end coverage for the opt-in endpoint Query cache (ADR-0054, #413). The
 * proof is a request-counting fake endpoint: when a source opts in, a second
 * identical `sparqly query` — in a *separate CLI process* — must answer from the
 * on-disk cache without issuing another remote round-trip. With no opt-in the
 * cache is never created and every run hits the endpoint.
 */
describe('sparqly query — endpoint Query cache (#413)', () => {
  let projectRoot: string;
  let endpoint: FakeSparqlEndpoint | undefined;

  beforeEach(async () => {
    projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'sparqly-query-cache-')),
    );
    // A `.git` boundary stops config auto-discovery from walking onto the host.
    await mkdir(join(projectRoot, '.git'));
  });

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function writeConfig(body: string): Promise<void> {
    await writeFile(join(projectRoot, 'sparqly.config.yaml'), body + '\n');
  }

  async function exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  const QUERY = ['query', '@live', '-q', 'SELECT ?s WHERE { ?s ?p ?o }'];

  it('answers a repeated query from the cache without a second remote round-trip', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON,
    }));
    await writeConfig(dedent`
      sources:
        - id: live
          endpoint: ${endpoint.url}
          queryCache: true
    `);

    const first = await runCli(QUERY, { cwd: projectRoot, env: CLEARED_ENV });
    expect(first.exitCode).toBe(0);
    const afterFirst = endpoint.requestCount();
    expect(afterFirst).toBeGreaterThan(0);

    const second = await runCli(QUERY, { cwd: projectRoot, env: CLEARED_ENV });
    expect(second.exitCode).toBe(0);

    // The second invocation issued no new request — it was served from the
    // cache written by the first, across a process restart.
    expect(endpoint.requestCount()).toBe(afterFirst);
    expect(JSON.parse(second.stdout)).toEqual(JSON.parse(first.stdout));
    expect(await exists(join(projectRoot, '.sparqly', 'cache'))).toBe(true);
  });

  it('issues a fresh round-trip every run and never creates the cache when no source opts in', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON,
    }));
    await writeConfig(dedent`
      sources:
        - id: live
          endpoint: ${endpoint.url}
    `);

    const first = await runCli(QUERY, { cwd: projectRoot, env: CLEARED_ENV });
    expect(first.exitCode).toBe(0);
    const afterFirst = endpoint.requestCount();

    const second = await runCli(QUERY, { cwd: projectRoot, env: CLEARED_ENV });
    expect(second.exitCode).toBe(0);

    // Not opted in: the second run re-queries the endpoint and the cache
    // directory was never touched.
    expect(endpoint.requestCount()).toBeGreaterThan(afterFirst);
    expect(await exists(join(projectRoot, '.sparqly', 'cache'))).toBe(false);
  });
});
