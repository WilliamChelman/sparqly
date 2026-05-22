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
 * End-to-end coverage for the `sparqly index` command (ADR-0041, #346): the
 * ahead-of-time builder for `storage: disk` Glob indexes. Builds every
 * disk-backed source (or a selected subset), skips a fresh index, and rebuilds
 * on `--force`.
 */
describe('sparqly index — disk-backed Glob index build (#346)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'sparqly-index-cmd-')),
    );
    // A `.git` boundary stops config auto-discovery from walking onto the host.
    await mkdir(join(projectRoot, '.git'));
    await mkdir(join(projectRoot, 'data'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  function manifestPath(sourceId: string): string {
    return join(projectRoot, '.sparqly', 'index', sourceId, 'manifest.json');
  }

  it('builds every disk-backed source and skips non-disk-backed ones', async () => {
    await mkdir(join(projectRoot, 'mem'));
    await writeFile(
      join(projectRoot, 'data', 'a.ttl'),
      '@prefix ex: <http://example.org/> .\nex:alice ex:knows ex:bob .\n',
    );
    await writeFile(
      join(projectRoot, 'mem', 'b.ttl'),
      '@prefix ex: <http://example.org/> .\nex:carol ex:knows ex:dave .\n',
    );
    await writeFile(
      join(projectRoot, 'sparqly.config.yaml'),
      dedent`
        sources:
          - id: data
            glob: data/*.ttl
            storage: disk
          - id: mem
            glob: mem/*.ttl
      ` + '\n',
    );

    const result = await runCli(['index'], {
      cwd: projectRoot,
      env: CLEARED_ENV,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('built');
    expect(result.stdout).toContain('@data');
    // The memory-tier glob has no Glob index and is left out of the report.
    expect(result.stdout).not.toContain('@mem');
    expect(await exists(manifestPath('data'))).toBe(true);
    expect(await exists(manifestPath('mem'))).toBe(false);
  });

  it('builds only the selected source when an @id arg is given', async () => {
    await mkdir(join(projectRoot, 'archive'));
    await writeFile(
      join(projectRoot, 'data', 'a.ttl'),
      '@prefix ex: <http://example.org/> .\nex:alice ex:p ex:b .\n',
    );
    await writeFile(
      join(projectRoot, 'archive', 'old.ttl'),
      '@prefix ex: <http://example.org/> .\nex:old ex:p ex:b .\n',
    );
    await writeFile(
      join(projectRoot, 'sparqly.config.yaml'),
      dedent`
        sources:
          - id: data
            glob: data/*.ttl
            storage: disk
          - id: archive
            glob: archive/*.ttl
            storage: disk
      ` + '\n',
    );

    const result = await runCli(['index', '@data'], {
      cwd: projectRoot,
      env: CLEARED_ENV,
    });

    expect(result.exitCode).toBe(0);
    expect(await exists(manifestPath('data'))).toBe(true);
    // The unselected disk-backed source was not built.
    expect(await exists(manifestPath('archive'))).toBe(false);
  });

  it('skips a fresh index and rebuilds it under --force', async () => {
    await writeFile(
      join(projectRoot, 'data', 'a.ttl'),
      '@prefix ex: <http://example.org/> .\nex:alice ex:p ex:b .\n',
    );
    await writeFile(
      join(projectRoot, 'sparqly.config.yaml'),
      dedent`
        sources:
          - id: data
            glob: data/*.ttl
            storage: disk
      ` + '\n',
    );

    const first = await runCli(['index'], {
      cwd: projectRoot,
      env: CLEARED_ENV,
    });
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain('built');

    const second = await runCli(['index'], {
      cwd: projectRoot,
      env: CLEARED_ENV,
    });
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain('skipped');

    const forced = await runCli(['index', '--force'], {
      cwd: projectRoot,
      env: CLEARED_ENV,
    });
    expect(forced.exitCode).toBe(0);
    expect(forced.stdout).toContain('built');
    expect(forced.stdout).toContain('forced');
  });

  it('rejects an explicit @id that is not a disk-backed source', async () => {
    await mkdir(join(projectRoot, 'mem'));
    await writeFile(
      join(projectRoot, 'mem', 'b.ttl'),
      '@prefix ex: <http://example.org/> .\nex:carol ex:p ex:b .\n',
    );
    await writeFile(
      join(projectRoot, 'sparqly.config.yaml'),
      dedent`
        sources:
          - id: mem
            glob: mem/*.ttl
      ` + '\n',
    );

    const result = await runCli(['index', '@mem'], {
      cwd: projectRoot,
      env: CLEARED_ENV,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/storage: disk/);
  });
});
