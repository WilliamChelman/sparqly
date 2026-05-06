import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

const CLEARED_ENV = {
  SPARQLY_MUTABLE: undefined,
  SPARQLY_VERBOSE: undefined,
  SPARQLY_QUIET: undefined,
  SPARQLY_SERVE_PORT: undefined,
  SPARQLY_SERVE_WATCH: undefined,
} as const;

describe('config file — validation policy', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-validation-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('type mismatch on serve.port (port: "abc") exits non-zero with a clear error', async () => {
    const configPath = join(scratch, 'sparqly.serve.yaml');
    await writeFile(configPath, 'port: "abc"\n');

    const result = await runCli(
      ['serve', '--config', configPath],
      { cwd: scratch, env: CLEARED_ENV },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/error:/);
    expect(result.stderr).toContain(configPath);
    expect(result.stderr).toMatch(/port/);
  });

  it('unknown top-level key is a strict-validation error', async () => {
    const configPath = join(scratch, 'sparqly.query.yaml');
    await writeFile(
      configPath,
      dedent`
        bogusTop: 1
        sources: "data/**/*.ttl"
      ` + '\n',
    );

    const result = await runCli(
      ['query', '--config', configPath],
      { cwd: scratch, env: CLEARED_ENV },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/error:/);
    expect(result.stderr).toContain(configPath);
    expect(result.stderr).toMatch(/bogusTop/);
  });
});
