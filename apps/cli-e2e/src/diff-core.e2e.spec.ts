import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { diffFixture, nonEmptyLines } from './helpers/hash';

describe('sparqly diff — core properties', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-diff-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('exits 0 with empty stdout when a single file matches its split-then-merged equivalent', async () => {
    const single = diffFixture('domain.ttl');
    const partsGlob = diffFixture('parts/*.ttl');

    const result = await runCli([
      'diff',
      '--quiet',
      single,
      partsGlob,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('exits 1 and prints an addition when the right side has an extra triple', async () => {
    const left = diffFixture('domain.ttl');
    const right = diffFixture('added.ttl');

    const result = await runCli(['diff', '--quiet', left, right]);

    expect(result.exitCode).toBe(1);
    const lines = nonEmptyLines(result.stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\+ <http:\/\/example\.org\/g> <http:\/\/example\.org\/s> <http:\/\/example\.org\/h> \.$/,
    );
  });

  it('exits 1 and prints a removal when the right side is missing a triple', async () => {
    const left = diffFixture('domain.ttl');
    const right = diffFixture('removed.ttl');

    const result = await runCli(['diff', '--quiet', left, right]);

    expect(result.exitCode).toBe(1);
    const lines = nonEmptyLines(result.stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^- <http:\/\/example\.org\/c> <http:\/\/example\.org\/q> <http:\/\/example\.org\/d> \.$/,
    );
  });

  it('writes the "# +<added> -<removed>" summary to stderr by default', async () => {
    const result = await runCli([
      'diff',
      diffFixture('domain.ttl'),
      diffFixture('added.ttl'),
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('# +1 -0\n');
  });

  it('--quiet suppresses the summary line', async () => {
    const result = await runCli([
      'diff',
      '--quiet',
      diffFixture('domain.ttl'),
      diffFixture('added.ttl'),
    ]);

    expect(result.stderr).toBe('');
  });

  it('--graph-strategy=none flattens quads so two .trig files with different graph names match', async () => {
    const result = await runCli([
      'diff',
      '--quiet',
      '--graph-strategy=none',
      diffFixture('quad/g1.trig'),
      diffFixture('quad/g2.trig'),
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('without --graph-strategy=none, two .trig files with different graph names diff as one removal + one addition', async () => {
    const result = await runCli([
      'diff',
      '--quiet',
      diffFixture('quad/g1.trig'),
      diffFixture('quad/g2.trig'),
    ]);

    expect(result.exitCode).toBe(1);
    const lines = nonEmptyLines(result.stdout);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^- /);
    expect(lines[0]).toContain('<http://example.org/g1>');
    expect(lines[1]).toMatch(/^\+ /);
    expect(lines[1]).toContain('<http://example.org/g2>');
  });

  describe('--format', () => {
    it('--format json emits {added,removed} of {s,p,o,g?} term objects', async () => {
      const result = await runCli([
        'diff',
        '--quiet',
        '--format=json',
        diffFixture('domain.ttl'),
        diffFixture('added.ttl'),
      ]);

      expect(result.exitCode).toBe(1);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.removed).toEqual([]);
      expect(parsed.added).toHaveLength(1);
      expect(parsed.added[0].s.value).toBe('http://example.org/g');
      expect(parsed.added[0].g).toBeUndefined();
    });

    it('--format json emits {"added":[],"removed":[]} on a clean match', async () => {
      const result = await runCli([
        'diff',
        '--quiet',
        '--format=json',
        diffFixture('domain.ttl'),
        diffFixture('parts/*.ttl'),
      ]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ added: [], removed: [] });
    });

    it('--format rdf-patch emits standard RDF Patch with D-then-A markers', async () => {
      const result = await runCli([
        'diff',
        '--quiet',
        '--format=rdf-patch',
        diffFixture('domain.ttl'),
        diffFixture('removed.ttl'),
      ]);

      expect(result.exitCode).toBe(1);
      const lines = nonEmptyLines(result.stdout);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^D <http:\/\/example\.org\/c> /);
    });

    it('exits 2 on an unknown --format value', async () => {
      const result = await runCli([
        'diff',
        '--quiet',
        '--format=bogus',
        diffFixture('domain.ttl'),
        diffFixture('domain.ttl'),
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/unknown.*--format/i);
    });
  });

  describe('exit codes', () => {
    it('exits 2 on a parse error in either side', async () => {
      const bad = join(scratch, 'broken.ttl');
      await writeFile(bad, 'this is not valid turtle <<<');

      const result = await runCli([
        'diff',
        '--quiet',
        diffFixture('domain.ttl'),
        bad,
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/broken\.ttl/);
    });

    it('exits 2 when only one positional argument is given', async () => {
      const result = await runCli([
        'diff',
        '--quiet',
        diffFixture('domain.ttl'),
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/two source specs/);
    });
  });

  describe('config integration', () => {
    it('reads diff.left and diff.right from --config', async () => {
      const configPath = join(scratch, 'sparqly.config.yaml');
      await writeFile(
        configPath,
        [
          'diff:',
          `  left: "${diffFixture('domain.ttl')}"`,
          `  right: "${diffFixture('parts/*.ttl')}"`,
          '',
        ].join('\n'),
      );

      const result = await runCli([
        'diff',
        '--quiet',
        '--config',
        configPath,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('');
    });

    it('SPARQLY_DIFF_FORMAT env triggers JSON output', async () => {
      const result = await runCli(
        [
          'diff',
          '--quiet',
          diffFixture('domain.ttl'),
          diffFixture('added.ttl'),
        ],
        { env: { SPARQLY_DIFF_FORMAT: 'json' } },
      );

      expect(result.exitCode).toBe(1);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.added).toHaveLength(1);
    });

    it('--print-config prints the diff block annotated with sources', async () => {
      const result = await runCli([
        'diff',
        '--print-config',
        '--format=rdf-patch',
        '--quiet',
        diffFixture('domain.ttl'),
        diffFixture('added.ttl'),
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('# sparqly diff --print-config');
      expect(result.stdout).toMatch(/format\s*:\s*"rdf-patch"\s+# flag/);
    });
  });
});
