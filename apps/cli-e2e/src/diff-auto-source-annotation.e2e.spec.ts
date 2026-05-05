import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

describe('sparqly diff — auto source annotation (ADR-0008)', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await realpath(
      await mkdtemp(join(tmpdir(), 'sparqly-diff-auto-annot-')),
    );
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('produces an HTML report with snippet blocks for the bare-CLI invocation, with no config file', async () => {
    const leftPath = join(scratch, 'left.ttl');
    const rightPath = join(scratch, 'right.ttl');
    const reportPath = join(scratch, 'report.html');
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
        `--left=${leftPath}`,
        `--right=${rightPath}`,
        '--format=html',
        `--out=${reportPath}`,
        '--quiet',
      ],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(1);
    const { readFile } = await import('node:fs/promises');
    const html = await readFile(reportPath, 'utf8');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toMatch(/<pre[^>]*class="snippet"/);
    // Source-record reference present per side.
    expect(html).toContain(`href="file://${leftPath}"`);
    expect(html).toContain(`href="file://${rightPath}"`);
  });

  it('--skip-auto-source-annotation suppresses snippet blocks for the same invocation', async () => {
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

    const result = await runCli(
      [
        'diff',
        '--quiet',
        '--format=html',
        '--skip-auto-source-annotation',
        leftPath,
        rightPath,
      ],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout.startsWith('<!doctype html>')).toBe(true);
    expect(result.stdout).not.toMatch(/<pre[^>]*class="snippet"/);
  });
});
