import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { hashFixture, hashLineRe, nonEmptyLines } from './helpers/hash';

describe('sparqly hash — multiple --sources and --json', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-hash-multi-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('two --sources flags produce two ordered output lines', async () => {
    const a = hashFixture('parts/one.ttl');
    const b = hashFixture('parts/two.ttl');

    const result = await runCli([
      'hash',
      '--quiet',
      '--sources',
      a,
      '--sources',
      b,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const lines = nonEmptyLines(result.stdout);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(hashLineRe(a));
    expect(lines[1]).toMatch(hashLineRe(b));
  });

  it('one bad source aborts the whole command with non-zero exit and no partial stdout', async () => {
    const good = hashFixture('parts/one.ttl');
    const bad = join(scratch, 'broken.ttl');
    await writeFile(bad, 'this is not valid turtle <<<');

    const result = await runCli([
      'hash',
      '--quiet',
      '--sources',
      good,
      '--sources',
      bad,
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/broken\.ttl/);
  });

  it('--json shape is [{ source, hash }] in input order', async () => {
    const a = hashFixture('parts/one.ttl');
    const b = hashFixture('parts/two.ttl');

    const result = await runCli([
      'hash',
      '--quiet',
      '--json',
      '--sources',
      b,
      '--sources',
      a,
    ]);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as Array<{
      source: string;
      hash: string;
    }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0].source).toBe(b);
    expect(parsed[1].source).toBe(a);
    expect(parsed[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed[1].hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
