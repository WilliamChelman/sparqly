import { spawn } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLI_BUNDLE_PATH, runCli } from './helpers/run-cli';

interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * Spawn the CLI and run a synchronous parent-side action the moment the
 * matching stderr line arrives. The action mutates the filesystem; the CLI
 * is expected to have inserted a deterministic pause between the trigger
 * line and the next filesystem read (via SPARQLY_DEBUG_PAUSE_BEFORE_SNIPPETS_MS),
 * so the action reliably lands before the read.
 */
function runCliWithStderrTrigger(
  args: string[],
  options: RunOptions,
  trigger: { match: string; act: () => void },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [CLI_BUNDLE_PATH, ...args], {
      cwd: options.cwd,
      env: { ...process.env, NODE_NO_WARNINGS: '1', ...(options.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let fired = false;
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
      if (!fired && stderr.includes(trigger.match)) {
        fired = true;
        trigger.act();
      }
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      resolvePromise({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

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

  it('produces a self-contained HTML document with per-record file links when both sides declare `annotateSource` (happy path)', async () => {
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
        sources:
          - id: left
            glob: "${leftPath}"
            transforms:
              - annotateSource: {}
          - id: right
            glob: "${rightPath}"
            transforms:
              - annotateSource: {}
      ` + '\n',
    );

    const result = await runCli(
      [
        'diff',
        '--quiet',
        '-f',
        'html',
        '--config',
        configPath,
        '--left',
        '@left',
        '--right',
        '@right',
      ],
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

  it('emits a stderr warning on HTML when both sides are views (no sidecar), suppressed by --quiet, and still exits with the diff code (ADR-0032)', async () => {
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
    const configPath = join(scratch, 'sparqly.diff.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: leftRaw
            glob: "${leftPath}"
          - id: rightRaw
            glob: "${rightPath}"
          - id: leftView
            from: "@leftRaw"
            query: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }"
          - id: rightView
            from: "@rightRaw"
            query: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }"
      ` + '\n',
    );

    const noisy = await runCli(
      [
        'diff',
        '-f',
        'html',
        '--config',
        configPath,
        '--left',
        '@leftView',
        '--right',
        '@rightView',
      ],
      { cwd: scratch },
    );

    expect(noisy.exitCode).toBe(1);
    expect(noisy.stderr).toContain('no source records present');
    expect(noisy.stdout.startsWith('<!doctype html>')).toBe(true);

    const quiet = await runCli(
      [
        'diff',
        '--quiet',
        '-f',
        'html',
        '--config',
        configPath,
        '--left',
        '@leftView',
        '--right',
        '@rightView',
      ],
      { cwd: scratch },
    );

    expect(quiet.exitCode).toBe(1);
    expect(quiet.stderr).toBe('');
  });

  it('rejects --snippet-context against a non-html format with a loud error', async () => {
    const leftPath = join(scratch, 'left.ttl');
    const rightPath = join(scratch, 'right.ttl');
    await writeFile(leftPath, '');
    await writeFile(rightPath, '');

    const result = await runCli(
      ['diff', '-f', 'human', '--snippet-context', '5', leftPath, rightPath],
      { cwd: scratch },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/--snippet-context/);
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
        sources:
          - id: left
            glob: "${leftPath}"
            transforms:
              - annotateSource: {}
          - id: right
            glob: "${rightPath}"
            transforms:
              - annotateSource: {}
      ` + '\n',
    );

    const result = await runCli(
      [
        'diff',
        '--quiet',
        '-f',
        'html',
        '-C',
        '5',
        '--config',
        configPath,
        '--left',
        '@left',
        '--right',
        '@right',
      ],
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

  it('renders `(source file unavailable)` and a non-empty HTML body when an annotated source file is removed between load and render', async () => {
    // The CLI loads each side into memory before calling the snippet reader,
    // so unlinking the source files between those phases drives the snippet
    // reader to the `unavailable` branch (reason: missing) — exercising the
    // composer's `(source file unavailable)` degraded-render path end-to-end.
    // We synchronize via SPARQLY_DEBUG_PAUSE_BEFORE_SNIPPETS_MS, which makes
    // the CLI emit a stable "sparqly-debug: pausing before snippets" stderr
    // marker after load completes and pause for the configured window so
    // the parent's unlink lands deterministically before snippet fetching.
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
        sources:
          - id: left
            glob: "${leftPath}"
            transforms:
              - annotateSource: {}
          - id: right
            glob: "${rightPath}"
            transforms:
              - annotateSource: {}
      ` + '\n',
    );

    const result = await runCliWithStderrTrigger(
      [
        'diff',
        '--quiet',
        '-f',
        'html',
        '--config',
        configPath,
        '--left',
        '@left',
        '--right',
        '@right',
      ],
      {
        cwd: scratch,
        env: { SPARQLY_DEBUG_PAUSE_BEFORE_SNIPPETS_MS: '500' },
      },
      {
        match: 'sparqly-debug: pausing before snippets',
        act: () => {
          unlinkSync(leftPath);
          unlinkSync(rightPath);
        },
      },
    );

    // Degraded render: still exits with the diff exit code.
    expect(result.exitCode).toBe(1);
    expect(result.stdout.startsWith('<!doctype html>')).toBe(true);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stdout).toContain('(source file unavailable)');
    expect(result.stdout).not.toMatch(/<pre[^>]*class="snippet"/);
    // Hunks still render their statements — degradation is per-snippet, not
    // per-hunk. The composer shortens IRIs against discovered prefixes, so
    // assert against the CURIE form.
    expect(result.stdout).toContain('ex:c');
    expect(result.stdout).toContain('ex:e');
  });

  it('rejects --snippet-context above 100', async () => {
    const leftPath = join(scratch, 'left.ttl');
    const rightPath = join(scratch, 'right.ttl');
    await writeFile(leftPath, '');
    await writeFile(rightPath, '');

    const result = await runCli(
      [
        'diff',
        '-f',
        'html',
        '--snippet-context',
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
