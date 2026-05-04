import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

describe('sparqly diff -f html', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await realpath(
      await mkdtemp(join(tmpdir(), 'sparqly-diff-html-')),
    );
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('produces a self-contained HTML document with per-record file links when both sides declare `annotate` (happy path)', async () => {
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
      ['diff', '--quiet', '-f', 'html', '--config', configPath],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout.startsWith('<!doctype html>')).toBe(true);
    expect(result.stdout).toContain('<style>');
    expect(result.stdout).not.toContain('<script');
    expect(result.stdout).not.toMatch(/<link\b/);

    // Removed hunk: left.ttl line 3 (the `ex:c ex:q ex:d .` triple).
    expect(result.stdout).toContain(`href="file://${leftPath}"`);
    expect(result.stdout).toContain(`>${relative(scratch, leftPath)}:3<`);
    expect(result.stdout).toContain('id="left.ttl-L3"');

    // Added hunk: right.ttl line 3.
    expect(result.stdout).toContain(`href="file://${rightPath}"`);
    expect(result.stdout).toContain(`>${relative(scratch, rightPath)}:3<`);
    expect(result.stdout).toContain('id="right.ttl-L3"');
  });

  it('emits a stderr warning when neither side declares `annotate`, suppressed by --quiet, and still exits with the diff code', async () => {
    const leftPath = join(scratch, 'left.ttl');
    const rightPath = join(scratch, 'right.ttl');
    await writeFile(
      leftPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:c ex:q ex:d .
      ` + '\n',
    );
    await writeFile(
      rightPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:e ex:r ex:f .
      ` + '\n',
    );

    const noisy = await runCli(
      ['diff', '-f', 'html', leftPath, rightPath],
      { cwd: scratch },
    );

    expect(noisy.exitCode).toBe(1);
    expect(noisy.stderr).toContain('no source records present');
    expect(noisy.stdout.startsWith('<!doctype html>')).toBe(true);

    const quiet = await runCli(
      ['diff', '--quiet', '-f', 'html', leftPath, rightPath],
      { cwd: scratch },
    );

    expect(quiet.exitCode).toBe(1);
    expect(quiet.stderr).toBe('');
  });

  it('rejects --context against a non-html format with a loud error', async () => {
    const leftPath = join(scratch, 'left.ttl');
    const rightPath = join(scratch, 'right.ttl');
    await writeFile(leftPath, '');
    await writeFile(rightPath, '');

    const result = await runCli(
      ['diff', '-f', 'human', '--context', '5', leftPath, rightPath],
      { cwd: scratch },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/--context/);
    expect(result.stderr).toMatch(/html/);
  });

  it('renders a per-record source-file snippet with line-numbered gutter and focal highlight when `-C 5` is given against an annotated source', async () => {
    const leftPath = join(scratch, 'left.ttl');
    const rightPath = join(scratch, 'right.ttl');
    // The right side puts the changed triple on line 6 so a 5-line context
    // window straddles a clear interior position.
    await writeFile(
      leftPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
      ` + '\n',
    );
    await writeFile(
      rightPath,
      dedent`
        @prefix ex: <http://example.org/> .

        ex:a ex:p ex:b .

        # changed triple below

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
      ['diff', '--quiet', '-f', 'html', '-C', '5', '--config', configPath],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(1);
    // <pre> snippet block emitted (the new I/O wiring).
    expect(result.stdout).toMatch(/<pre[^>]*class="snippet"/);
    // Focal highlight: class `focal` AND inline background style.
    expect(result.stdout).toMatch(
      /<span class="line focal" style="background:[^"]+">/,
    );
    // Line-numbered gutter present for several lines around the focal one.
    expect(result.stdout).toMatch(/<span class="gutter">\d+<\/span>/);
    // Specifically: the focal line for the right-side change is line 7
    // (after the comment on line 6), and -C 5 widens the window to cover
    // line 2 through line 7+.
    expect(result.stdout).toContain('<span class="gutter">7</span>');
    expect(result.stdout).toContain('<span class="gutter">2</span>');
  });

  it('rejects --context above 100', async () => {
    const leftPath = join(scratch, 'left.ttl');
    const rightPath = join(scratch, 'right.ttl');
    await writeFile(leftPath, '');
    await writeFile(rightPath, '');

    const result = await runCli(
      [
        'diff',
        '-f',
        'html',
        '--context',
        '101',
        leftPath,
        rightPath,
      ],
      { cwd: scratch },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/100|context/i);
  });
});
