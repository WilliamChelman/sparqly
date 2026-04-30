import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { diffFixture } from './helpers/hash';

describe('sparqly diff --out', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-diff-out-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  const left = (): string => diffFixture('domain.ttl');
  const right = (): string => diffFixture('added.ttl');

  it('byte-parity with stdout for --format human', async () => {
    const baseline = await runCli(['diff', '--quiet', left(), right()]);
    expect(baseline.exitCode).toBe(1);

    const target = join(scratch, 'patch.diff');
    const result = await runCli([
      'diff',
      '--quiet',
      '--out',
      target,
      left(),
      right(),
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(await readFile(target, 'utf8')).toBe(baseline.stdout);
  });

  it('byte-parity with stdout for --format json', async () => {
    const baseline = await runCli([
      'diff',
      '--quiet',
      '--format=json',
      left(),
      right(),
    ]);
    expect(baseline.exitCode).toBe(1);

    const target = join(scratch, 'patch.json');
    const result = await runCli([
      'diff',
      '--quiet',
      '--format=json',
      '--out',
      target,
      left(),
      right(),
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(await readFile(target, 'utf8')).toBe(baseline.stdout);
  });

  it('byte-parity with stdout for --format rdf-patch', async () => {
    const baseline = await runCli([
      'diff',
      '--quiet',
      '--format=rdf-patch',
      left(),
      right(),
    ]);
    expect(baseline.exitCode).toBe(1);

    const target = join(scratch, 'patch.rdfp');
    const result = await runCli([
      'diff',
      '--quiet',
      '--format=rdf-patch',
      '--out',
      target,
      left(),
      right(),
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(await readFile(target, 'utf8')).toBe(baseline.stdout);
  });

  it('still emits the "# +N -M" summary on stderr when --out is set', async () => {
    const target = join(scratch, 'patch.diff');
    const result = await runCli([
      'diff',
      '--out',
      target,
      left(),
      right(),
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('# +1 -0\n');
  });

  it('--quiet still suppresses the summary when --out is set', async () => {
    const target = join(scratch, 'patch.diff');
    const result = await runCli([
      'diff',
      '--quiet',
      '--out',
      target,
      left(),
      right(),
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
  });
});
