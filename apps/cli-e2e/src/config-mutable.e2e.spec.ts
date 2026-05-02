import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

const CLEARED_ENV = {
  SPARQLY_MUTABLE: undefined,
  SPARQLY_QUERY_MUTABLE: undefined,
  SPARQLY_IMMUTABLE: undefined,
  SPARQLY_QUERY_IMMUTABLE: undefined,
  SPARQLY_SOURCES: undefined,
  SPARQLY_QUERY_SOURCES: undefined,
  SPARQLY_GRAPH_MODE: undefined,
  SPARQLY_VERBOSE: undefined,
  SPARQLY_QUIET: undefined,
} as const;

function mutableLine(stdout: string): string {
  const line = stdout.split('\n').find((l) => l.startsWith('mutable'));
  if (!line) throw new Error('no mutable line in --print-config output');
  return line;
}

describe('config — mutable canonicalization', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-mutable-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('mutable: true in the config file is honoured', async () => {
    const configPath = join(scratch, 'sparqly.config.yaml');
    await writeFile(configPath, 'mutable: true\n');

    const result = await runCli(
      ['query', '--print-config', '--config', configPath],
      { cwd: scratch, env: CLEARED_ENV },
    );

    expect(result.exitCode).toBe(0);
    expect(mutableLine(result.stdout)).toMatch(/true.*# file/);
  });

  it('SPARQLY_MUTABLE=true env var is honoured', async () => {
    const result = await runCli(['query', '--print-config'], {
      cwd: scratch,
      env: { ...CLEARED_ENV, SPARQLY_MUTABLE: 'true' },
    });

    expect(result.exitCode).toBe(0);
    expect(mutableLine(result.stdout)).toMatch(/true.*# env/);
  });

  it('--mutable CLI flag is honoured', async () => {
    const result = await runCli(['query', '--print-config', '--mutable'], {
      cwd: scratch,
      env: CLEARED_ENV,
    });

    expect(result.exitCode).toBe(0);
    expect(mutableLine(result.stdout)).toMatch(/true.*# flag/);
  });

  it('--immutable=false CLI flag is honoured', async () => {
    const result = await runCli(
      ['query', '--print-config', '--immutable=false'],
      { cwd: scratch, env: CLEARED_ENV },
    );

    expect(result.exitCode).toBe(0);
    expect(mutableLine(result.stdout)).toMatch(/true.*# flag/);
  });

  it('--immutable (no value) keeps mutable false on top of a config that set it true', async () => {
    const configPath = join(scratch, 'sparqly.config.yaml');
    await writeFile(configPath, 'mutable: true\n');

    const result = await runCli(
      ['query', '--print-config', '--config', configPath, '--immutable'],
      { cwd: scratch, env: CLEARED_ENV },
    );

    expect(result.exitCode).toBe(0);
    expect(mutableLine(result.stdout)).toMatch(/false.*# flag/);
  });

  it('immutable key in the config file is rejected with a strict-validation error', async () => {
    const configPath = join(scratch, 'sparqly.query.yaml');
    await writeFile(configPath, 'immutable: true\n');

    const result = await runCli(
      ['query', '--print-config', '--config', configPath],
      { cwd: scratch, env: CLEARED_ENV },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/error:/);
    expect(result.stderr).toContain('immutable');
    expect(result.stderr).toContain(configPath);
  });

  it('SPARQLY_IMMUTABLE env var is not accepted (mutable stays at default)', async () => {
    const result = await runCli(['query', '--print-config'], {
      cwd: scratch,
      env: { ...CLEARED_ENV, SPARQLY_IMMUTABLE: 'true' },
    });

    expect(result.exitCode).toBe(0);
    expect(mutableLine(result.stdout)).toMatch(/false.*# default/);
  });
});
