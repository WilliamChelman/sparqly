import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { hashFixture, nonEmptyLines } from './helpers/hash';

describe('sparqly hash --out', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-hash-out-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('byte-parity with stdout for the default <hash>  <source> line output', async () => {
    const single = hashFixture('domain.ttl');

    const baseline = await runCli(['hash', '--quiet', single]);
    expect(baseline.exitCode).toBe(0);

    const target = join(scratch, 'hashes.txt');
    const result = await runCli(['hash', '--quiet', '--out', target, single]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(await readFile(target, 'utf8')).toBe(baseline.stdout);
  });

  it('byte-parity with stdout for --json mode', async () => {
    const single = hashFixture('domain.ttl');

    const baseline = await runCli(['hash', '--quiet', '--json', single]);
    expect(baseline.exitCode).toBe(0);

    const target = join(scratch, 'hashes.json');
    const result = await runCli([
      'hash',
      '--quiet',
      '--json',
      '--out',
      target,
      single,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(await readFile(target, 'utf8')).toBe(baseline.stdout);
  });

  it('writes all results in input order for repeated --sources', async () => {
    const a = hashFixture('parts/one.ttl');
    const b = hashFixture('parts/two.ttl');

    const target = join(scratch, 'multi.txt');
    const result = await runCli([
      'hash',
      '--quiet',
      '-s',
      b,
      '-s',
      a,
      '--out',
      target,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    const lines = nonEmptyLines(await readFile(target, 'utf8'));
    expect(lines).toHaveLength(2);
    expect(lines[0].endsWith(`  ${b}`)).toBe(true);
    expect(lines[1].endsWith(`  ${a}`)).toBe(true);
  });

  it('rejects --out combined with --compare-with with exit 2 and a clear error', async () => {
    const single = hashFixture('domain.ttl');
    const target = join(scratch, 'should-not-exist.txt');

    const result = await runCli([
      'hash',
      '--quiet',
      '--out',
      target,
      '--compare-with',
      single,
      single,
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/--out.*--compare-with/);
    await expect(readFile(target, 'utf8')).rejects.toThrow();
  });
});
