import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

const CLEARED_ENV = {
  SPARQLY_SOURCES: undefined,
  SPARQLY_QUERY_SOURCES: undefined,
  SPARQLY_GRAPH_STRATEGY: undefined,
  SPARQLY_MUTABLE: undefined,
  SPARQLY_VERBOSE: undefined,
  SPARQLY_QUIET: undefined,
} as const;

describe('config file — discovery and explicit --config', () => {
  let scratch: string;
  let subdir: string;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-discovery-'));
    scratch = await realpath(dir);
    subdir = join(scratch, 'nested', 'deeper');
    await mkdir(subdir, { recursive: true });
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it.each(['sparqly.config.yaml', 'sparqly.config.yml'] as const)(
    'auto-discovers %s walking up from a subdirectory',
    async (filename) => {
      const sources = `${scratch}/data/**/*.ttl`;
      await writeFile(
        join(scratch, filename),
        ['query:', `  sources: "${sources}"`, ''].join('\n'),
      );

      const result = await runCli(['query', '--print-config'], {
        cwd: subdir,
        env: CLEARED_ENV,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`# config file: ${join(scratch, filename)}`);
      expect(result.stdout).toMatch(
        new RegExp(`sources\\s*:.*${escapeRe(sources)}.*# file`),
      );
    },
  );

  it('auto-discovers sparqly.config.json walking up from a subdirectory', async () => {
    const sources = `${scratch}/data/**/*.ttl`;
    const filepath = join(scratch, 'sparqly.config.json');
    await writeFile(filepath, JSON.stringify({ query: { sources } }));

    const result = await runCli(['query', '--print-config'], {
      cwd: subdir,
      env: CLEARED_ENV,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`# config file: ${filepath}`);
    expect(result.stdout).toMatch(
      new RegExp(`sources\\s*:.*${escapeRe(sources)}.*# file`),
    );
  });

  it('logs the discovered config-file path under --verbose', async () => {
    const filepath = join(scratch, 'sparqly.config.yaml');
    await writeFile(
      filepath,
      ['query:', `  sources: "${scratch}/x/**/*.ttl"`, ''].join('\n'),
    );

    const result = await runCli(['query', '--print-config', '--verbose'], {
      cwd: subdir,
      env: CLEARED_ENV,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(`Loaded config from ${filepath}`);
  });

  it('--config <path> loads the specified file even when a different file would be auto-discovered', async () => {
    const autoSources = `${scratch}/auto/**/*.ttl`;
    const explicitSources = `${scratch}/explicit/**/*.ttl`;
    await writeFile(
      join(scratch, 'sparqly.config.yaml'),
      ['query:', `  sources: "${autoSources}"`, ''].join('\n'),
    );
    const explicitPath = join(scratch, 'explicit.yaml');
    await writeFile(
      explicitPath,
      ['query:', `  sources: "${explicitSources}"`, ''].join('\n'),
    );

    const result = await runCli(
      ['query', '--print-config', '--config', explicitPath],
      { cwd: subdir, env: CLEARED_ENV },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`# config file: ${explicitPath}`);
    expect(result.stdout).toMatch(
      new RegExp(`sources\\s*:.*${escapeRe(explicitSources)}.*# file`),
    );
    expect(result.stdout).not.toContain(autoSources);
  });

  it('--config <missing> exits non-zero with a clear error message', async () => {
    const missing = join(scratch, 'does-not-exist.yaml');

    const result = await runCli(
      ['query', '--print-config', '--config', missing],
      { cwd: scratch, env: CLEARED_ENV },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/error:/);
    expect(result.stderr).toContain(missing);
  });

  it('--config <malformed> exits non-zero with a clear error message', async () => {
    const malformed = join(scratch, 'broken.yaml');
    await writeFile(malformed, 'query:\n  sources: "unterminated\n');

    const result = await runCli(
      ['query', '--print-config', '--config', malformed],
      { cwd: scratch, env: CLEARED_ENV },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/error:/);
    expect(result.stderr).toContain(malformed);
  });
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
