import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

const CLEARED_ENV = {
  SPARQLY_SOURCES: undefined,
  SPARQLY_QUERY_SOURCES: undefined,
  SPARQLY_GRAPH_MODE: undefined,
  SPARQLY_QUERY_GRAPH_MODE: undefined,
  SPARQLY_MUTABLE: undefined,
  SPARQLY_QUERY_MUTABLE: undefined,
  SPARQLY_VERBOSE: undefined,
  SPARQLY_QUIET: undefined,
} as const;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourceLine(stdout: string, key: string): string {
  const line = stdout.split('\n').find((l) => l.startsWith(key));
  if (!line) throw new Error(`no '${key}' line in --print-config output`);
  return line;
}

describe('config file — precedence chain', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-precedence-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('file value beats default (graphMode)', async () => {
    const configPath = join(scratch, 'sparqly.query.yaml');
    await writeFile(configPath, 'graphMode: fillDefault\n');

    const result = await runCli(
      ['query', '--print-config', '--config', configPath],
      { cwd: scratch, env: CLEARED_ENV },
    );

    expect(result.exitCode).toBe(0);
    expect(sourceLine(result.stdout, 'graphMode')).toMatch(
      /"fillDefault".*# file/,
    );
  });

  it('SPARQLY_<KEY> env var beats file value', async () => {
    const configPath = join(scratch, 'sparqly.query.yaml');
    await writeFile(configPath, 'graphMode: fillDefault\n');

    const result = await runCli(
      ['query', '--print-config', '--config', configPath],
      {
        cwd: scratch,
        env: { ...CLEARED_ENV, SPARQLY_GRAPH_MODE: 'forceAll' },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(sourceLine(result.stdout, 'graphMode')).toMatch(
      /"forceAll".*# env/,
    );
  });

  it('SPARQLY_<COMMAND>_<KEY> env var beats SPARQLY_<KEY> for that command', async () => {
    const result = await runCli(['query', '--print-config'], {
      cwd: scratch,
      env: {
        ...CLEARED_ENV,
        SPARQLY_SOURCES: 'shared/**/*.ttl',
        SPARQLY_QUERY_SOURCES: 'query/**/*.ttl',
      },
    });

    expect(result.exitCode).toBe(0);
    expect(sourceLine(result.stdout, 'sources')).toMatch(
      new RegExp(`"${escapeRe('query/**/*.ttl')}".*# env`),
    );
  });

  it('CLI flag beats env var', async () => {
    const result = await runCli(
      ['query', '--print-config', '--graph-mode', 'forceAll'],
      {
        cwd: scratch,
        env: { ...CLEARED_ENV, SPARQLY_GRAPH_MODE: 'fillDefault' },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(sourceLine(result.stdout, 'graphMode')).toMatch(
      /"forceAll".*# flag/,
    );
  });

  it('positional [glob] beats sources from any lower tier', async () => {
    const configPath = join(scratch, 'sparqly.query.yaml');
    await writeFile(configPath, 'sources: "from-file/**/*.ttl"\n');

    const result = await runCli(
      [
        'query',
        '--print-config',
        '--config',
        configPath,
        'positional/**/*.ttl',
      ],
      {
        cwd: scratch,
        env: { ...CLEARED_ENV, SPARQLY_SOURCES: 'from-env/**/*.ttl' },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(sourceLine(result.stdout, 'sources')).toMatch(
      new RegExp(`"${escapeRe('positional/**/*.ttl')}".*# flag`),
    );
  });
});
