import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

describe('sparqly format --write', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-format-write-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rewrites a dirty file in place and exits 0', async () => {
    const dirty = dedent`
      @prefix ex: <http://example.org/> .
      @prefix unused: <http://other.example/> .

      ex:c ex:p ex:d .
      ex:a ex:p ex:b .
      ex:a a ex:Thing .
    ` + '\n';
    const file = join(dir, 'data.ttl');
    await writeFile(file, dirty);

    const result = await runCli(['format', '--write', 'data.ttl'], {
      cwd: dir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    const after = await readFile(file, 'utf8');
    expect(after).not.toBe(dirty);
    expect(after).toMatchInlineSnapshot(`
      "@prefix ex: <http://example.org/>.

      ex:a a ex:Thing;
          ex:p ex:b.

      ex:c ex:p ex:d.
      "
    `);
  });
});

describe('sparqly format --check', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-format-check-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('exits 0 with no output when every matched file is already formatted', async () => {
    const dirty = dedent`
      @prefix ex: <http://example.org/> .

      ex:c ex:p ex:d .
      ex:a ex:p ex:b .
    ` + '\n';
    const file = join(dir, 'data.ttl');
    await writeFile(file, dirty);
    // Format once via --write to produce a clean baseline.
    const seed = await runCli(['format', '--write', 'data.ttl'], { cwd: dir });
    expect(seed.exitCode).toBe(0);

    const result = await runCli(['format', '--check', 'data.ttl'], {
      cwd: dir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('exits 2 when a matched file fails to parse', async () => {
    const file = join(dir, 'broken.ttl');
    await writeFile(file, 'this is not valid turtle <<<\n');

    const result = await runCli(['format', '--check', 'broken.ttl'], {
      cwd: dir,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/error:/);
  });

  it('exits 1, lists unformatted file paths to stdout, and does not mutate files', async () => {
    const dirty = dedent`
      @prefix ex: <http://example.org/> .
      @prefix unused: <http://other.example/> .

      ex:c ex:p ex:d .
      ex:a ex:p ex:b .
    ` + '\n';
    const file = join(dir, 'data.ttl');
    await writeFile(file, dirty);

    const result = await runCli(['format', '--check', 'data.ttl'], {
      cwd: dir,
    });

    expect(result.exitCode).toBe(1);
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0].endsWith('/data.ttl')).toBe(true);
    const after = await readFile(file, 'utf8');
    expect(after).toBe(dirty);
  });
});

describe('sparqly format — mutual exclusion', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-format-mx-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects --write combined with --check with a clear error', async () => {
    const file = join(dir, 'data.ttl');
    await writeFile(file, '@prefix ex: <http://example.org/> .\nex:a ex:p ex:b .\n');

    const result = await runCli(
      ['format', '--write', '--check', 'data.ttl'],
      { cwd: dir },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('--write and --check are mutually exclusive');
    // The file must remain untouched on the rejection path.
    const after = await readFile(file, 'utf8');
    expect(after).toBe(
      '@prefix ex: <http://example.org/> .\nex:a ex:p ex:b .\n',
    );
  });
});
