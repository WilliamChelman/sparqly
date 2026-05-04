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

  it('appends a `# <relative-path>:<line>` trailing comment per +/- hunk when both sides declare `annotate`', async () => {
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
            - annotate: {}
        right:
          glob: "${rightPath}"
          transforms:
            - annotate: {}
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

  it('does not emit any trailing `#` comment when neither side declares `annotate` (regression guard)', async () => {
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
      ['diff', '--quiet', leftPath, rightPath],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(1);
    const lines = nonEmptyLines(result.stdout);
    expect(lines).toEqual(['- ex:c ex:q ex:d .', '+ ex:e ex:r ex:f .']);
    for (const line of lines) {
      expect(line).not.toMatch(/#/);
    }
  });

  it('writes a stderr summary line when exactly one side declares `annotate`, suppressed by --quiet', async () => {
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
            - annotate: {}
        right: "${rightPath}"
      ` + '\n',
    );

    const noisy = await runCli(['diff', '--config', configPath], {
      cwd: scratch,
    });

    expect(noisy.exitCode).toBe(1);
    expect(noisy.stderr).toContain('source records present on left only');
    expect(noisy.stderr).toContain('right side hunks will not be annotated');
    expect(noisy.stderr).toContain('# +1 -1\n');

    const quiet = await runCli(['diff', '--quiet', '--config', configPath], {
      cwd: scratch,
    });

    expect(quiet.exitCode).toBe(1);
    expect(quiet.stderr).toBe('');
  });
});
