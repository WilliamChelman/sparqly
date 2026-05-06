import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { hashFixture, hashLineRe, leadingHash, nonEmptyLines } from './helpers/hash';

describe('sparqly hash --compare-with', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-hash-compare-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('exits 0 and prints "match: <hash>" on a clean split', async () => {
    const single = hashFixture('domain.ttl');
    const partsGlob = hashFixture('parts/*.ttl');

    const result = await runCli([
      'hash',
      '--quiet',
      single,
      '--compare-with',
      partsGlob,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^match: [0-9a-f]{64}\n$/);
    expect(result.stderr).toBe('');
  });

  it('exits 1 and prints both labeled hashes on mismatch', async () => {
    const single = hashFixture('domain.ttl');
    const driftGlob = hashFixture('drift/*.ttl');

    const result = await runCli([
      'hash',
      '--quiet',
      single,
      '--compare-with',
      driftGlob,
    ]);

    expect(result.exitCode).toBe(1);
    const lines = nonEmptyLines(result.stdout);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(hashLineRe(single));
    expect(lines[1]).toMatch(hashLineRe(driftGlob));
    expect(leadingHash(lines[0])).not.toBe(leadingHash(lines[1]));
  });

  it.each([
    ['primary', 'bad', 'good'],
    ['compare-with', 'good', 'bad'],
  ] as const)(
    'exits 2 and writes nothing to stdout when the %s source fails to parse',
    async (_label, primaryKind, compareKind) => {
      const bad = join(scratch, 'broken.ttl');
      await writeFile(bad, 'this is not valid turtle <<<');
      const good = hashFixture('domain.ttl');
      const primary = primaryKind === 'good' ? good : bad;
      const compare = compareKind === 'good' ? good : bad;

      const result = await runCli([
        'hash',
        '--quiet',
        primary,
        '--compare-with',
        compare,
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/broken\.ttl/);
    },
  );

  it('exits 2 when no primary source is provided', async () => {
    const good = hashFixture('domain.ttl');

    const result = await runCli([
      'hash',
      '--quiet',
      '--compare-with',
      good,
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/registry is empty|no target source/i);
  });

  it('rejects --graph-mode as an unknown option (#135 — graph-name semantics live on transforms)', async () => {
    const single = hashFixture('domain.ttl');

    const result = await runCli([
      'hash',
      '--quiet',
      '--graph-mode=flatten',
      single,
      '--compare-with',
      single,
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/unknown option.*--graph-mode/i);
  });
});
