import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

const CLEARED_ENV = {
  SPARQLY_SOURCES: undefined,
  SPARQLY_GRAPH_STRATEGY: undefined,
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
    const configPath = join(scratch, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      ['serve:', '  port: "abc"', ''].join('\n'),
    );

    const result = await runCli(
      ['serve', '--print-config', '--config', configPath],
      { cwd: scratch, env: CLEARED_ENV },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/error:/);
    expect(result.stderr).toContain(configPath);
    expect(result.stderr).toMatch(/port/);
  });

  it('unknown top-level key triggers a warning on stderr and the run continues', async () => {
    const configPath = join(scratch, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      ['bogusTop: 1', 'sources: "data/**/*.ttl"', ''].join('\n'),
    );

    const result = await runCli(
      ['query', '--print-config', '--config', configPath],
      { cwd: scratch, env: CLEARED_ENV },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toMatch(/warning:.*bogusTop/);
    expect(result.stdout).toContain('# sparqly query --print-config');
    expect(result.stdout).toMatch(/sources\s*:\s*"data\/\*\*\/\*\.ttl"\s+# file/);
  });
});
