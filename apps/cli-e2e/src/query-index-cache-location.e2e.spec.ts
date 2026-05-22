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
 * End-to-end coverage for the config-overridable Glob index cache location
 * (ADR-0041, #345): a top-level `index.dir` config field redirects the cache
 * root, so a `storage: disk` glob's index builds and is reused under
 * `<index.dir>/<source-id>/` instead of `<configDir>/.sparqly/index/<id>/`.
 */
describe('sparqly query — index cache location override (#345)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'sparqly-index-cache-')),
    );
    // A `.git` boundary stops config auto-discovery from walking onto the host.
    await mkdir(join(projectRoot, '.git'));
    await mkdir(join(projectRoot, 'data'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function writeConfig(indexDir: string): Promise<void> {
    await writeFile(
      join(projectRoot, 'sparqly.config.yaml'),
      dedent`
        sources:
          - id: data
            glob: data/*.ttl
            storage: disk
        index:
          dir: ${indexDir}
      ` + '\n',
    );
  }

  async function exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  it('builds the Glob index under the configured `index.dir`, clear of .sparqly/index', async () => {
    await writeFile(
      join(projectRoot, 'data', 'a.ttl'),
      '@prefix ex: <http://example.org/> .\nex:alice ex:knows ex:bob .\n',
    );
    await writeConfig('index-volume');

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

    // The index materialized under the configured override root — and the
    // default `<configDir>/.sparqly/index/` was never created.
    expect(
      await exists(join(projectRoot, 'index-volume', 'data', 'manifest.json')),
    ).toBe(true);
    expect(await exists(join(projectRoot, '.sparqly', 'index'))).toBe(false);
  });

  it('reuses the override-located index on a second query run', async () => {
    const source = join(projectRoot, 'data', 'a.ttl');
    await writeFile(
      source,
      '@prefix ex: <http://example.org/> .\nex:original ex:p ex:b .\n',
    );
    await writeConfig('index-volume');
    const query = ['query', '@data', '-q', 'SELECT ?s WHERE { ?s ?p ?o }'];

    const first = await runCli(query, { cwd: projectRoot, env: CLEARED_ENV });
    expect(first.exitCode).toBe(0);

    // The source changes after the index was built under the override root.
    await writeFile(
      source,
      '@prefix ex: <http://example.org/> .\nex:changed ex:p ex:b .\n',
    );

    const second = await runCli(query, { cwd: projectRoot, env: CLEARED_ENV });
    expect(second.exitCode).toBe(0);
    const bindings = JSON.parse(second.stdout).results.bindings as Array<{
      s: { value: string };
    }>;
    // The second run reopened the index already built under
    // `index-volume/data/` — it answers the originally indexed quad. A look at
    // the wrong cache root would rebuild and surface `ex:changed` instead.
    expect(bindings.map((b) => b.s.value)).toEqual([
      'http://example.org/original',
    ]);
  });
});
