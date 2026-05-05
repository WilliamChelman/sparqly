import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { nonEmptyLines } from './helpers/hash';

describe('sparqly diff -f human — source-record trailing comments', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await realpath(
      await mkdtemp(join(tmpdir(), 'sparqly-diff-srcrec-')),
    );
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('appends a `# <relative-path>:<line>` trailing comment per +/- hunk when both sides declare `annotateSource`', async () => {
    const leftPath = join(scratch, 'left.ttl');
    const rightPath = join(scratch, 'right.ttl');
    await writeFile(
      leftPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );
    await writeFile(
      rightPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:e ex:r ex:f .
      ` + '\n',
    );
    const configPath = join(scratch, 'sparqly.diff.yaml');
    await writeFile(
      configPath,
      dedent`
        left:
          glob: "${leftPath}"
          transforms:
            - annotateSource: {}
        right:
          glob: "${rightPath}"
          transforms:
            - annotateSource: {}
      ` + '\n',
    );

    const result = await runCli(
      ['diff', '--quiet', '--config', configPath],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(1);
    const lines = nonEmptyLines(result.stdout);
    expect(lines).toEqual([
      `- ex:c ex:q ex:d . # ${relative(scratch, leftPath)}:3`,
      `+ ex:e ex:r ex:f . # ${relative(scratch, rightPath)}:3`,
    ]);
  });

  it('does not emit any trailing `#` comment when --skip-auto-source-annotation is passed against inline globs (regression guard)', async () => {
    const leftPath = join(scratch, 'left.ttl');
    const rightPath = join(scratch, 'right.ttl');
    await writeFile(
      leftPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );
    await writeFile(
      rightPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:e ex:r ex:f .
      ` + '\n',
    );

    const result = await runCli(
      ['diff', '--quiet', '--skip-auto-source-annotation', leftPath, rightPath],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(1);
    const lines = nonEmptyLines(result.stdout);
    expect(lines).toEqual(['- ex:c ex:q ex:d .', '+ ex:e ex:r ex:f .']);
    for (const line of lines) {
      expect(line).not.toMatch(/#/);
    }
  });

  it('appends a `sourceRecords` field per added/removed entry on `--format=json` when both sides declare `annotateSource`', async () => {
    const leftPath = join(scratch, 'left.ttl');
    const rightPath = join(scratch, 'right.ttl');
    await writeFile(
      leftPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );
    await writeFile(
      rightPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:e ex:r ex:f .
      ` + '\n',
    );
    const configPath = join(scratch, 'sparqly.diff.yaml');
    await writeFile(
      configPath,
      dedent`
        left:
          glob: "${leftPath}"
          transforms:
            - annotateSource: {}
        right:
          glob: "${rightPath}"
          transforms:
            - annotateSource: {}
      ` + '\n',
    );

    const result = await runCli(
      ['diff', '--quiet', '--format=json', '--config', configPath],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.removed).toHaveLength(1);
    expect(parsed.removed[0].sourceRecords).toEqual([
      { file: `file://${leftPath}`, line: 3 },
    ]);
    expect(parsed.added).toHaveLength(1);
    expect(parsed.added[0].sourceRecords).toEqual([
      { file: `file://${rightPath}`, line: 3 },
    ]);
  });

  it('omits `sourceRecords` from every json entry when --skip-auto-source-annotation is passed against inline globs (regression guard)', async () => {
    const leftPath = join(scratch, 'left.ttl');
    const rightPath = join(scratch, 'right.ttl');
    await writeFile(
      leftPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );
    await writeFile(
      rightPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:e ex:r ex:f .
      ` + '\n',
    );

    const result = await runCli(
      [
        'diff',
        '--quiet',
        '--format=json',
        '--skip-auto-source-annotation',
        leftPath,
        rightPath,
      ],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.removed).toHaveLength(1);
    expect(parsed.added).toHaveLength(1);
    for (const entry of [...parsed.added, ...parsed.removed]) {
      expect(entry.sourceRecords).toBeUndefined();
    }
  });

  it('appends a `# <relative-path>:<line>` trailing comment per D/A line on `--format=rdf-patch` when both sides declare `annotateSource`', async () => {
    const leftPath = join(scratch, 'left.ttl');
    const rightPath = join(scratch, 'right.ttl');
    await writeFile(
      leftPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );
    await writeFile(
      rightPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:e ex:r ex:f .
      ` + '\n',
    );
    const configPath = join(scratch, 'sparqly.diff.yaml');
    await writeFile(
      configPath,
      dedent`
        left:
          glob: "${leftPath}"
          transforms:
            - annotateSource: {}
        right:
          glob: "${rightPath}"
          transforms:
            - annotateSource: {}
      ` + '\n',
    );

    const result = await runCli(
      ['diff', '--quiet', '--format=rdf-patch', '--config', configPath],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(1);
    const lines = nonEmptyLines(result.stdout);
    expect(lines).toEqual([
      `D <http://example.org/c> <http://example.org/q> <http://example.org/d> . # ${relative(scratch, leftPath)}:3`,
      `A <http://example.org/e> <http://example.org/r> <http://example.org/f> . # ${relative(scratch, rightPath)}:3`,
    ]);
  });

  it('does not emit any trailing `#` comment on `--format=rdf-patch` when --skip-auto-source-annotation is passed against inline globs (regression guard)', async () => {
    const leftPath = join(scratch, 'left.ttl');
    const rightPath = join(scratch, 'right.ttl');
    await writeFile(
      leftPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );
    await writeFile(
      rightPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:e ex:r ex:f .
      ` + '\n',
    );

    const result = await runCli(
      [
        'diff',
        '--quiet',
        '--format=rdf-patch',
        '--skip-auto-source-annotation',
        leftPath,
        rightPath,
      ],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(1);
    const lines = nonEmptyLines(result.stdout);
    expect(lines).toEqual([
      'D <http://example.org/c> <http://example.org/q> <http://example.org/d> .',
      'A <http://example.org/e> <http://example.org/r> <http://example.org/f> .',
    ]);
    for (const line of lines) {
      expect(line).not.toMatch(/#/);
    }
  });

  it('writes a stderr summary line when exactly one side declares `annotateSource` (with --skip-auto-source-annotation suppressing the implicit injection on the other side), suppressed by --quiet', async () => {
    const leftPath = join(scratch, 'left.ttl');
    const rightPath = join(scratch, 'right.ttl');
    await writeFile(
      leftPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );
    await writeFile(
      rightPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:e ex:r ex:f .
      ` + '\n',
    );
    const configPath = join(scratch, 'sparqly.diff.yaml');
    await writeFile(
      configPath,
      dedent`
        left:
          glob: "${leftPath}"
          transforms:
            - annotateSource: {}
        right: "${rightPath}"
      ` + '\n',
    );

    const noisy = await runCli(
      ['diff', '--skip-auto-source-annotation', '--config', configPath],
      { cwd: scratch },
    );

    expect(noisy.exitCode).toBe(1);
    expect(noisy.stderr).toContain('source records present on left only');
    expect(noisy.stderr).toContain('right side hunks will not be annotated');
    expect(noisy.stderr).toContain('# +1 -1\n');

    const quiet = await runCli(
      [
        'diff',
        '--quiet',
        '--skip-auto-source-annotation',
        '--config',
        configPath,
      ],
      { cwd: scratch },
    );

    expect(quiet.exitCode).toBe(1);
    expect(quiet.stderr).toBe('');
  });
});
