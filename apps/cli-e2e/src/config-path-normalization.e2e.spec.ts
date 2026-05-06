import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nonEmptyLines } from './helpers/hash';
import { runCli } from './helpers/run-cli';

const CLEARED_ENV = {
  SPARQLY_CONFIG: undefined,
  SPARQLY_VERBOSE: undefined,
  SPARQLY_QUIET: undefined,
} as const;

describe('sparqly config — eager path normalization (ADR-0010)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'sparqly-path-norm-')),
    );
    await mkdir(join(projectRoot, '.git'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('a config-relative glob in an ancestor config matches the same files from any subdirectory', async () => {
    await mkdir(join(projectRoot, 'data'));
    await writeFile(
      join(projectRoot, 'data', 'a.ttl'),
      '@prefix ex: <http://example.org/> .\nex:s ex:p ex:o .\n',
    );

    await writeFile(
      join(projectRoot, 'sparqly.config.yaml'),
      dedent`
        sources:
          - id: data
            glob: data/*.ttl
      ` + '\n',
    );

    const sub = join(projectRoot, 'pkg', 'src');
    await mkdir(sub, { recursive: true });

    const fromRoot = await runCli(['hash', '--quiet'], {
      cwd: projectRoot,
      env: CLEARED_ENV,
    });
    const fromSub = await runCli(['hash', '--quiet'], {
      cwd: sub,
      env: CLEARED_ENV,
    });

    expect(fromRoot.exitCode).toBe(0);
    expect(fromSub.exitCode).toBe(0);
    const rootLines = nonEmptyLines(fromRoot.stdout);
    const subLines = nonEmptyLines(fromSub.stdout);
    expect(rootLines).toHaveLength(1);
    expect(subLines).toEqual(rootLines);
    expect(rootLines[0]).toMatch(/^[0-9a-f]{64} {2}@data$/);
  });
});
