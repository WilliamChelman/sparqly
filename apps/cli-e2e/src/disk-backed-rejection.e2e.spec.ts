import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
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

const TURTLE =
  '@prefix ex: <http://example.org/> .\nex:alice ex:knows ex:bob .\n';

/**
 * End-to-end coverage for the residual rejection surface left after ADR-0047:
 * `hash` (CLI-only) and an in-memory glob fall-through. Diff's disk-backed
 * surface is covered in `diff-pass-through-view.e2e.spec.ts`; this file keeps
 * the `hash` rejection and the in-memory unaffected paths.
 */
describe('sparqly hash — disk-backed glob rejection (#343, ADR-0041 / ADR-0047)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'sparqly-disk-reject-')),
    );
    // A `.git` boundary stops config auto-discovery from walking onto the host.
    await mkdir(join(projectRoot, '.git'));
    await mkdir(join(projectRoot, 'data'));
    await mkdir(join(projectRoot, 'mem'));
    await writeFile(join(projectRoot, 'data', 'a.ttl'), TURTLE);
    await writeFile(join(projectRoot, 'mem', 'a.ttl'), TURTLE);
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
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('hash rejects a disk-backed glob with a clear, explanatory error', async () => {
    const result = await runCli(['hash', '@data'], {
      cwd: projectRoot,
      env: CLEARED_ENV,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('@data');
    expect(result.stderr).toMatch(/cannot be hashed/i);
    expect(result.stderr).toMatch(/canonicaliz/i);
    expect(result.stderr).toMatch(/wrap it in a `view`/i);
  });

  it('leaves an in-memory glob unaffected: hash succeeds', async () => {
    const result = await runCli(['hash', '--quiet', '@mem'], {
      cwd: projectRoot,
      env: CLEARED_ENV,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^[0-9a-f]{64} {2}/);
  });

  it('leaves an in-memory glob unaffected: diff succeeds', async () => {
    const result = await runCli(['diff', '--quiet', '@mem', '@mem'], {
      cwd: projectRoot,
      env: CLEARED_ENV,
    });

    // Identical sources on both sides — no diff, clean exit 0.
    expect(result.exitCode).toBe(0);
  });
});
