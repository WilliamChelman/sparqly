import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { hashFixture, hashLineRe, nonEmptyLines } from './helpers/hash';

const CLEARED_ENV = {} as const;

describe('sparqly hash — config file + env precedence', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-hash-config-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('reads the sole registry entry from the config file when no CLI/env override is given', async () => {
    const single = hashFixture('domain.ttl');
    const configPath = join(scratch, 'sparqly.hash.yaml');
    await writeFile(configPath, `sources:\n  - "${single}"\n`);

    const result = await runCli(['hash', '--quiet', '--config', configPath], {
      env: CLEARED_ENV,
    });

    expect(result.exitCode).toBe(0);
    const lines = nonEmptyLines(result.stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(hashLineRe(single));
  });

  it('CLI --source overrides the registry default', async () => {
    const fromConfig = hashFixture('parts/one.ttl');
    const fromCli = hashFixture('domain.ttl');
    const configPath = join(scratch, 'sparqly.hash.yaml');
    await writeFile(configPath, `sources:\n  - "${fromConfig}"\n`);

    const result = await runCli(
      [
        'hash',
        '--quiet',
        '--config',
        configPath,
        '--source',
        fromCli,
      ],
      { env: CLEARED_ENV },
    );

    expect(result.exitCode).toBe(0);
    const lines = nonEmptyLines(result.stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(hashLineRe(fromCli));
  });

  it('rejects `json: true` at config root with a friendly per-invocation message', async () => {
    const single = hashFixture('domain.ttl');
    const configPath = join(scratch, 'sparqly.hash.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - "${single}"
        json: true
      ` + '\n',
    );

    const result = await runCli(['hash', '--quiet', '--config', configPath], {
      env: CLEARED_ENV,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/json at root not allowed.*per-invocation/);
  });

  it('rejects `compareWith` at config root with a friendly per-invocation message', async () => {
    const single = hashFixture('domain.ttl');
    const partsGlob = hashFixture('parts/*.ttl');
    const configPath = join(scratch, 'sparqly.hash.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - "${single}"
        compareWith: "${partsGlob}"
      ` + '\n',
    );

    const result = await runCli(['hash', '--quiet', '--config', configPath], {
      env: CLEARED_ENV,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(
      /compareWith at root not allowed.*per-invocation/,
    );
  });

  it('an ambiguous multi-entry registry without `default: true` errors with available `@ids`', async () => {
    const a = hashFixture('parts/one.ttl');
    const b = hashFixture('parts/two.ttl');
    const configPath = join(scratch, 'sparqly.hash.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: alpha
            glob: "${a}"
          - id: beta
            glob: "${b}"
      ` + '\n',
    );

    const result = await runCli(['hash', '--quiet', '--config', configPath], {
      env: CLEARED_ENV,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/@alpha.*@beta/s);
  });

  it('a registry entry marked `default: true` is auto-picked when no --source is given', async () => {
    const a = hashFixture('parts/one.ttl');
    const b = hashFixture('parts/two.ttl');
    const configPath = join(scratch, 'sparqly.hash.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: alpha
            glob: "${a}"
          - id: beta
            glob: "${b}"
            default: true
      ` + '\n',
    );

    const result = await runCli(['hash', '--quiet', '--config', configPath], {
      env: CLEARED_ENV,
    });

    expect(result.exitCode).toBe(0);
    const lines = nonEmptyLines(result.stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^[0-9a-f]{64} {2}@beta$/);
  });
});
