import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

const CLEARED_ENV = {
  SPARQLY_CONFIG: undefined,
  SPARQLY_VERBOSE: undefined,
  SPARQLY_QUIET: undefined,
} as const;

/**
 * End-to-end coverage for the disk-backed glob query path (ADR-0041, #338):
 * `sparqly query` against a `storage: disk` source builds a Glob index under
 * `<configDir>/.sparqly/index/<source-id>/` and answers SPARQL from it.
 */
describe('sparqly query — disk-backed glob (ADR-0041)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'sparqly-query-disk-')),
    );
    // A `.git` boundary stops config auto-discovery from walking onto the host.
    await mkdir(join(projectRoot, '.git'));
    await mkdir(join(projectRoot, 'data'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function writeConfig(): Promise<void> {
    await writeFile(
      join(projectRoot, 'sparqly.config.yaml'),
      dedent`
        sources:
          - id: data
            glob: data/*.ttl
            storage: disk
      ` + '\n',
    );
  }

  it('builds a Glob index and answers SPARQL against a `storage: disk` source', async () => {
    await writeFile(
      join(projectRoot, 'data', 'a.ttl'),
      '@prefix ex: <http://example.org/> .\nex:alice ex:knows ex:bob .\n',
    );
    await writeConfig();

    const result = await runCli(
      ['query', '@data', '-q', 'SELECT ?s WHERE { ?s ?p ?o }'],
      { cwd: projectRoot, env: CLEARED_ENV },
    );

    expect(result.exitCode).toBe(0);
    const bindings = JSON.parse(result.stdout).results.bindings as Array<{
      s: { value: string };
    }>;
    expect(bindings.map((b) => b.s.value)).toEqual([
      'http://example.org/alice',
    ]);

    // The index materialized on disk under <configDir>/.sparqly/index/<id>/.
    const manifest = await stat(
      join(projectRoot, '.sparqly', 'index', 'data', 'manifest.json'),
    );
    expect(manifest.isFile()).toBe(true);
  });

  it('reuses the existing index directory on a second query run', async () => {
    const source = join(projectRoot, 'data', 'a.ttl');
    await writeFile(
      source,
      '@prefix ex: <http://example.org/> .\nex:original ex:p ex:b .\n',
    );
    await writeConfig();
    const query = ['query', '@data', '-q', 'SELECT ?s WHERE { ?s ?p ?o }'];

    const first = await runCli(query, { cwd: projectRoot, env: CLEARED_ENV });
    expect(first.exitCode).toBe(0);

    // The source changes after the index was built.
    await writeFile(
      source,
      '@prefix ex: <http://example.org/> .\nex:changed ex:p ex:b .\n',
    );

    const second = await runCli(query, { cwd: projectRoot, env: CLEARED_ENV });
    expect(second.exitCode).toBe(0);
    const bindings = JSON.parse(second.stdout).results.bindings as Array<{
      s: { value: string };
    }>;
    // Naive reuse (#338): the second run answered from the original index,
    // unaware of the edit. Staleness detection is a later slice.
    expect(bindings.map((b) => b.s.value)).toEqual([
      'http://example.org/original',
    ]);
  });
});
