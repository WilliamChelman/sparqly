import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

describe('sparqly format --out', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-format-out-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('rejects --out combined with --write with a clear error', async () => {
    const file = join(scratch, 'data.ttl');
    await writeFile(file, '@prefix ex: <http://example.org/> .\nex:a ex:p ex:b .\n');
    const target = join(scratch, 'should-not-exist.ttl');

    const result = await runCli(
      ['format', '--write', '--out', target, 'data.ttl'],
      { cwd: scratch },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      '--out cannot be combined with --write or --check',
    );
    await expect(readFile(target, 'utf8')).rejects.toThrow();
  });

  it('creates missing parent directories', async () => {
    const ttl =
      dedent`
        @prefix ex: <http://example.org/> .

        ex:a ex:p ex:b .
      ` + '\n';
    await writeFile(join(scratch, 'data.ttl'), ttl);

    const target = join(scratch, 'a', 'b', 'c', 'out.ttl');
    const result = await runCli(
      ['format', '--quiet', '--out', target, 'data.ttl'],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(0);
    expect(await readFile(target, 'utf8')).toMatch(/ex:a ex:p ex:b/);
  });

  it('writes byte-identical Turtle content to file as it would to stdout (stdin)', async () => {
    const ttl =
      dedent`
        @prefix ex: <http://example.org/> .

        ex:c ex:p ex:d .
        ex:a ex:p ex:b .
      ` + '\n';

    const baseline = await runCli(['format', '--quiet'], { stdin: ttl });
    expect(baseline.exitCode).toBe(0);
    expect(baseline.stdout).not.toBe('');

    const target = join(scratch, 'out.ttl');
    const result = await runCli(['format', '--quiet', '--out', target], {
      stdin: ttl,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(await readFile(target, 'utf8')).toBe(baseline.stdout);
  });

  it('writes byte-identical TriG content to file as it would to stdout (positional glob)', async () => {
    const trig =
      dedent`
        @prefix ex: <http://example.org/> .

        ex:dflt ex:p ex:o .
        ex:gA { ex:s ex:p ex:o }
        ex:gM { ex:s ex:p ex:o }
      ` + '\n';
    await writeFile(join(scratch, 'data.trig'), trig);

    const baseline = await runCli(['format', '--quiet', 'data.trig'], {
      cwd: scratch,
    });
    expect(baseline.exitCode).toBe(0);
    expect(baseline.stdout).not.toBe('');

    const target = join(scratch, 'out.trig');
    const result = await runCli(
      ['format', '--quiet', '--out', target, 'data.trig'],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(await readFile(target, 'utf8')).toBe(baseline.stdout);
  });

  it('writes byte-identical Turtle content to file as it would to stdout (positional glob)', async () => {
    const ttl =
      dedent`
        @prefix ex: <http://example.org/> .
        @prefix unused: <http://other.example/> .

        ex:c ex:p ex:d .
        ex:a ex:p ex:b .
      ` + '\n';
    await writeFile(join(scratch, 'data.ttl'), ttl);

    const baseline = await runCli(['format', '--quiet', 'data.ttl'], {
      cwd: scratch,
    });
    expect(baseline.exitCode).toBe(0);

    const target = join(scratch, 'out.ttl');
    const result = await runCli(
      ['format', '--quiet', '--out', target, 'data.ttl'],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(await readFile(target, 'utf8')).toBe(baseline.stdout);
  });
});
