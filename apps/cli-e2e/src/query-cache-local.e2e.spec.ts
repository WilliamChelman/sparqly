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
import { runCli } from './helpers/run-cli';

const CLEARED_ENV = {
  SPARQLY_CONFIG: undefined,
  SPARQLY_QUIET: undefined,
} as const;

// Verbose so the read-through seam's `query-cache status=hit|miss` debug line
// (text format `status=miss`) lands on stderr where the test can observe it.
const VERBOSE_ENV = { ...CLEARED_ENV, SPARQLY_VERBOSE: '1' } as const;

function subjectsOf(stdout: string): string[] {
  return JSON.parse(stdout).results.bindings.map(
    (b: { s: { value: string } }) => b.s.value,
  );
}

/**
 * End-to-end coverage for the local-source Query cache (ADR-0054, #415). Unlike
 * an endpoint, a materialized glob has no remote round-trip to count, so the
 * proof is two-fold: a repeated query in a *separate CLI process* reports a cache
 * hit (the on-disk entry survives the restart), and editing the underlying file
 * folds a new freshness token into the key — the next run is a miss and returns
 * the *new* content, never a stale cached body.
 */
describe('sparqly query — local-source Query cache (#415)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'sparqly-query-cache-local-')),
    );
    // A `.git` boundary stops config auto-discovery from walking onto the host.
    await mkdir(join(projectRoot, '.git'));
    await mkdir(join(projectRoot, 'data'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function writeConfig(body: string): Promise<void> {
    await writeFile(join(projectRoot, 'sparqly.config.yaml'), body + '\n');
  }

  async function writeData(turtle: string): Promise<void> {
    await writeFile(join(projectRoot, 'data', 'a.ttl'), turtle);
  }

  async function exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  const QUERY = ['query', '@vocab', '-q', 'SELECT ?s WHERE { ?s ?p ?o }'];

  it('hits the on-disk cache on a repeat, then recomputes the new content after an edit', async () => {
    await writeConfig(dedent`
      sources:
        - id: vocab
          glob: data/*.ttl
          queryCache: true
    `);
    await writeData('@prefix ex: <http://example.org/> . ex:a ex:p ex:b .');

    const first = await runCli(QUERY, { cwd: projectRoot, env: VERBOSE_ENV });
    expect(first.exitCode).toBe(0);
    expect(subjectsOf(first.stdout)).toEqual(['http://example.org/a']);
    expect(first.stderr).toMatch(/query-cache.*status=miss/);
    expect(await exists(join(projectRoot, '.sparqly', 'cache'))).toBe(true);

    // A second, byte-identical query in a fresh process is served from the
    // on-disk entry the first run wrote.
    const second = await runCli(QUERY, { cwd: projectRoot, env: VERBOSE_ENV });
    expect(second.exitCode).toBe(0);
    expect(second.stderr).toMatch(/query-cache.*status=hit/);
    expect(subjectsOf(second.stdout)).toEqual(['http://example.org/a']);

    // Edit the matched file (different subject, different byte length): the
    // stat-digest moves, so the key changes — the next run misses and returns
    // the new subject, not the stale cached `ex:a`.
    await writeData('@prefix ex: <http://example.org/> . ex:changed ex:p ex:b .');
    const third = await runCli(QUERY, { cwd: projectRoot, env: VERBOSE_ENV });
    expect(third.exitCode).toBe(0);
    expect(third.stderr).toMatch(/query-cache.*status=miss/);
    expect(subjectsOf(third.stdout)).toEqual(['http://example.org/changed']);
  });

  it('never creates the cache when a glob source does not opt in', async () => {
    await writeConfig(dedent`
      sources:
        - id: vocab
          glob: data/*.ttl
    `);
    await writeData('@prefix ex: <http://example.org/> . ex:a ex:p ex:b .');

    const first = await runCli(QUERY, { cwd: projectRoot, env: CLEARED_ENV });
    expect(first.exitCode).toBe(0);
    const second = await runCli(QUERY, { cwd: projectRoot, env: CLEARED_ENV });
    expect(second.exitCode).toBe(0);

    expect(await exists(join(projectRoot, '.sparqly', 'cache'))).toBe(false);
  });
});
