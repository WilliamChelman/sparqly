import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

describe('sparqly diff --format=turtle', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-diff-turtle-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('emits two formatter blocks with shared prefixes from the source files', async () => {
    const left = join(dir, 'left.ttl');
    const right = join(dir, 'right.ttl');
    await writeFile(
      left,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );
    await writeFile(
      right,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:e ex:r ex:f .
      ` + '\n',
    );

    const result = await runCli([
      'diff',
      '--quiet',
      '--format=turtle',
      left,
      right,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');

    const removedHeader = result.stdout.indexOf('# --- removed ---');
    const addedHeader = result.stdout.indexOf('# --- added ---');
    expect(removedHeader).toBeGreaterThanOrEqual(0);
    expect(addedHeader).toBeGreaterThan(removedHeader);

    const removedBlock = result.stdout.slice(removedHeader, addedHeader);
    const addedBlock = result.stdout.slice(addedHeader);

    // Each block runs through the formatter: prefixes applied, CURIEs used.
    expect(removedBlock).toContain('@prefix ex: <http://example.org/>');
    expect(removedBlock).toContain('ex:c ex:q ex:d');
    expect(removedBlock).not.toContain('<http://example.org/c>');

    expect(addedBlock).toContain('@prefix ex: <http://example.org/>');
    expect(addedBlock).toContain('ex:e ex:r ex:f');
    expect(addedBlock).not.toContain('<http://example.org/e>');
  });

  it('default --format=human applies CURIE shortening on each line', async () => {
    const left = join(dir, 'left.ttl');
    const right = join(dir, 'right.ttl');
    await writeFile(
      left,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );
    await writeFile(
      right,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:e ex:r ex:f .
      ` + '\n',
    );

    const result = await runCli(['diff', '--quiet', left, right]);

    expect(result.exitCode).toBe(1);
    const lines = result.stdout.split('\n').filter((l) => l.length > 0);
    expect(lines).toEqual(['- ex:c ex:q ex:d .', '+ ex:e ex:r ex:f .']);
  });

  it('source-file prefix wins over config when names conflict (turtle mode)', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      dedent`
        prefixes:
          ex: "http://config.example/"
      ` + '\n',
    );
    const left = join(dir, 'left.ttl');
    const right = join(dir, 'right.ttl');
    await writeFile(
      left,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
      ` + '\n',
    );
    await writeFile(
      right,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );

    const result = await runCli(
      ['diff', '--quiet', '--format=turtle', left, right],
      { cwd: dir },
    );

    expect(result.exitCode).toBe(1);
    // Source file's `ex:` mapping wins; config's `http://config.example/`
    // mapping is dropped because it conflicts on the same name.
    expect(result.stdout).toContain('@prefix ex: <http://example.org/>');
    expect(result.stdout).not.toContain('<http://config.example/>');
    expect(result.stdout).toContain('ex:c ex:q ex:d');
  });

  it('source-file prefix wins over config when names conflict (human mode)', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      dedent`
        prefixes:
          ex: "http://config.example/"
      ` + '\n',
    );
    const left = join(dir, 'left.ttl');
    const right = join(dir, 'right.ttl');
    await writeFile(
      left,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
      ` + '\n',
    );
    await writeFile(
      right,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );

    const result = await runCli(['diff', '--quiet', left, right], {
      cwd: dir,
    });

    expect(result.exitCode).toBe(1);
    const lines = result.stdout.split('\n').filter((l) => l.length > 0);
    expect(lines).toEqual(['+ ex:c ex:q ex:d .']);
  });

  it('--format=json is unchanged: full IRIs, even when prefixes are configured', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      dedent`
        prefixes:
          ex: "http://example.org/"
      ` + '\n',
    );
    const left = join(dir, 'left.ttl');
    const right = join(dir, 'right.ttl');
    await writeFile(
      left,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
      ` + '\n',
    );
    await writeFile(
      right,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );

    const result = await runCli(
      ['diff', '--quiet', '--format=json', left, right],
      { cwd: dir },
    );

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.added).toHaveLength(1);
    expect(parsed.added[0].s.value).toBe('http://example.org/c');
    expect(parsed.added[0].p.value).toBe('http://example.org/q');
  });

  it('--format=rdf-patch is unchanged: full IRIs, even when prefixes are configured', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      dedent`
        prefixes:
          ex: "http://example.org/"
      ` + '\n',
    );
    const left = join(dir, 'left.ttl');
    const right = join(dir, 'right.ttl');
    await writeFile(
      left,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
      ` + '\n',
    );
    await writeFile(
      right,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );

    const result = await runCli(
      ['diff', '--quiet', '--format=rdf-patch', left, right],
      { cwd: dir },
    );

    expect(result.exitCode).toBe(1);
    const lines = result.stdout.split('\n').filter((l) => l.length > 0);
    expect(lines).toEqual([
      'A <http://example.org/c> <http://example.org/q> <http://example.org/d> .',
    ]);
  });

  it('emits both block headers even when one side is empty', async () => {
    const left = join(dir, 'left.ttl');
    const right = join(dir, 'right.ttl');
    await writeFile(
      left,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
      ` + '\n',
    );
    await writeFile(
      right,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );

    const result = await runCli([
      'diff',
      '--quiet',
      '--format=turtle',
      left,
      right,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('# --- removed ---');
    expect(result.stdout).toContain('# --- added ---');
    expect(result.stdout).toContain('ex:c ex:q ex:d');
  });
});
