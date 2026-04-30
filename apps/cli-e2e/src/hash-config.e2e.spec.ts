import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { escapeRe, hashFixture, hashLineRe, nonEmptyLines } from './helpers/hash';

const CLEARED_ENV = {
  SPARQLY_HASH_SOURCES: undefined,
  SPARQLY_HASH_JSON: undefined,
  SPARQLY_HASH_COMPARE_WITH: undefined,
  SPARQLY_HASH_GRAPH_STRATEGY: undefined,
} as const;

describe('sparqly hash — config file + env precedence + --print-config', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-hash-config-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('reads sources from the hash: block when no CLI/env override is given', async () => {
    const single = hashFixture('domain.ttl');
    const configPath = join(scratch, 'sparqly.config.yaml');
    await writeFile(configPath, ['hash:', `  sources: "${single}"`, ''].join('\n'));

    const result = await runCli(['hash', '--quiet', '--config', configPath], {
      env: CLEARED_ENV,
    });

    expect(result.exitCode).toBe(0);
    const lines = nonEmptyLines(result.stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(hashLineRe(single));
  });

  it('SPARQLY_HASH_SOURCES env overrides hash.sources from the config file', async () => {
    const fromConfig = hashFixture('parts/one.ttl');
    const fromEnv = hashFixture('domain.ttl');
    const configPath = join(scratch, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      ['hash:', `  sources: "${fromConfig}"`, ''].join('\n'),
    );

    const result = await runCli(['hash', '--quiet', '--config', configPath], {
      env: { ...CLEARED_ENV, SPARQLY_HASH_SOURCES: fromEnv },
    });

    expect(result.exitCode).toBe(0);
    const lines = nonEmptyLines(result.stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(hashLineRe(fromEnv));
  });

  it('CLI --sources overrides both env and config', async () => {
    const fromConfig = hashFixture('parts/one.ttl');
    const fromEnv = hashFixture('parts/two.ttl');
    const fromCli = hashFixture('domain.ttl');
    const configPath = join(scratch, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      ['hash:', `  sources: "${fromConfig}"`, ''].join('\n'),
    );

    const result = await runCli(
      [
        'hash',
        '--quiet',
        '--config',
        configPath,
        '--sources',
        fromCli,
      ],
      { env: { ...CLEARED_ENV, SPARQLY_HASH_SOURCES: fromEnv } },
    );

    expect(result.exitCode).toBe(0);
    const lines = nonEmptyLines(result.stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(hashLineRe(fromCli));
  });

  it('hash.json: true in the config file is equivalent to --json', async () => {
    const single = hashFixture('domain.ttl');
    const configPath = join(scratch, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      ['hash:', `  sources: "${single}"`, '  json: true', ''].join('\n'),
    );

    const result = await runCli(['hash', '--quiet', '--config', configPath], {
      env: CLEARED_ENV,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as Array<{
      source: string;
      hash: string;
    }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].source).toBe(single);
    expect(parsed[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('SPARQLY_HASH_COMPARE_WITH env triggers compare mode', async () => {
    const single = hashFixture('domain.ttl');
    const partsGlob = hashFixture('parts/*.ttl');

    const result = await runCli(['hash', '--quiet', single], {
      env: { ...CLEARED_ENV, SPARQLY_HASH_COMPARE_WITH: partsGlob },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^match: [0-9a-f]{64}\n$/);
  });

  it('hash.compareWith in the config file triggers compare mode', async () => {
    const single = hashFixture('domain.ttl');
    const partsGlob = hashFixture('parts/*.ttl');
    const configPath = join(scratch, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      [
        'hash:',
        `  sources: "${single}"`,
        `  compareWith: "${partsGlob}"`,
        '',
      ].join('\n'),
    );

    const result = await runCli(['hash', '--quiet', '--config', configPath], {
      env: CLEARED_ENV,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^match: [0-9a-f]{64}\n$/);
  });

  it('--print-config prints the merged hash config with source annotations and exits 0', async () => {
    const single = hashFixture('domain.ttl');
    const configPath = join(scratch, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      ['hash:', `  sources: "${single}"`, ''].join('\n'),
    );

    const result = await runCli(
      ['hash', '--config', configPath, '--print-config', '--graph-strategy=none'],
      { env: CLEARED_ENV },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('# sparqly hash --print-config');
    expect(result.stdout).toMatch(
      new RegExp(`sources\\s*:\\s*"${escapeRe(single)}"\\s+# file`),
    );
    expect(result.stdout).toMatch(/graphStrategy\s*:\s*"none"\s+# flag/);
  });

  it('--print-config annotates env-sourced values with "# env"', async () => {
    const single = hashFixture('domain.ttl');

    const result = await runCli(['hash', '--print-config'], {
      env: { ...CLEARED_ENV, SPARQLY_HASH_SOURCES: single },
      cwd: scratch,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(
      new RegExp(`sources\\s*:\\s*"${escapeRe(single)}"\\s+# env`),
    );
  });

  it('SPARQLY_HASH_JSON=true is equivalent to --json', async () => {
    const single = hashFixture('domain.ttl');

    const result = await runCli(['hash', '--quiet', single], {
      env: { ...CLEARED_ENV, SPARQLY_HASH_JSON: 'true' },
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as Array<{
      source: string;
      hash: string;
    }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].source).toBe(single);
    expect(parsed[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hash.sources accepts an array in the config file', async () => {
    const a = hashFixture('parts/one.ttl');
    const b = hashFixture('parts/two.ttl');
    const configPath = join(scratch, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      ['hash:', '  sources:', `    - "${a}"`, `    - "${b}"`, ''].join('\n'),
    );

    const result = await runCli(['hash', '--quiet', '--config', configPath], {
      env: CLEARED_ENV,
    });

    expect(result.exitCode).toBe(0);
    const lines = nonEmptyLines(result.stdout);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(hashLineRe(a));
    expect(lines[1]).toMatch(hashLineRe(b));
  });
});
