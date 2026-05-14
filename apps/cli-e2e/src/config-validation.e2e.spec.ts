import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

const CLEARED_ENV = {
  SPARQLY_VERBOSE: undefined,
  SPARQLY_QUIET: undefined,
  SPARQLY_PORT: undefined,
} as const;

describe('config file — validation policy', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-validation-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('an invalid config exits non-zero with a clear error pointing at the file', async () => {
    const configPath = join(scratch, 'sparqly.serve.yaml');
    await writeFile(configPath, 'port: "abc"\n');

    const result = await runCli(
      ['serve', '--config', configPath],
      { cwd: scratch, env: CLEARED_ENV },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/error:/);
    expect(result.stderr).toContain(configPath);
  });
});
