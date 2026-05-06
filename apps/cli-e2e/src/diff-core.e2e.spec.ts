import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { diffBodyLines, diffFixture } from './helpers/hash';

describe('sparqly diff — core properties', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-diff-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('exits 0 with no body diff when a single file matches its split-then-merged equivalent', async () => {
    const single = diffFixture('domain.ttl');
    const partsGlob = diffFixture('parts/*.ttl');

    const result = await runCli([
      'diff',
      '--quiet',
      single,
      partsGlob,
    ]);

    expect(result.exitCode).toBe(0);
    expect(diffBodyLines(result.stdout)).toEqual([]);
    expect(result.stdout).toMatch(/^# left=\d+ right=\d+ \+0 -0\n$/);
    expect(result.stderr).toBe('');
  });

  it('exits 1 and prints an addition when the right side has an extra triple (human mode shortens via source prefixes)', async () => {
    const left = diffFixture('domain.ttl');
    const right = diffFixture('added.ttl');

    const result = await runCli([
      'diff',
      '--quiet',
      '--skip-auto-source-annotation',
      left,
      right,
    ]);

    expect(result.exitCode).toBe(1);
    const lines = diffBodyLines(result.stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('+ ex:g ex:s ex:h .');
  });

  it('exits 1 and prints a removal when the right side is missing a triple (human mode shortens via source prefixes)', async () => {
    const left = diffFixture('domain.ttl');
    const right = diffFixture('removed.ttl');

    const result = await runCli([
      'diff',
      '--quiet',
      '--skip-auto-source-annotation',
      left,
      right,
    ]);

    expect(result.exitCode).toBe(1);
    const lines = diffBodyLines(result.stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('- ex:c ex:q ex:d .');
  });

  it('writes the "# +<added> -<removed>" summary to stderr by default', async () => {
    const result = await runCli([
      'diff',
      diffFixture('domain.ttl'),
      diffFixture('added.ttl'),
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('# left=3 right=4 +1 -0\n');
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

  it('--graph-mode=flatten flattens quads so two .trig files with different graph names match', async () => {
    const result = await runCli([
      'diff',
      '--quiet',
      '--graph-mode=flatten',
      '--skip-auto-source-annotation',
      diffFixture('quad/g1.trig'),
      diffFixture('quad/g2.trig'),
    ]);

    expect(result.exitCode).toBe(0);
    expect(diffBodyLines(result.stdout)).toEqual([]);
    expect(result.stdout).toMatch(/^# left=\d+ right=\d+ \+0 -0\n$/);
  });

  it('without --graph-mode=flatten, two .trig files with different graph names diff as one removal + one addition', async () => {
    const result = await runCli([
      'diff',
      '--quiet',
      diffFixture('quad/g1.trig'),
      diffFixture('quad/g2.trig'),
    ]);

    expect(result.exitCode).toBe(1);
    const lines = diffBodyLines(result.stdout);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^- /);
    expect(lines[0]).toContain('ex:g1');
    expect(lines[1]).toMatch(/^\+ /);
    expect(lines[1]).toContain('ex:g2');
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
      expect(JSON.parse(result.stdout)).toEqual({
        added: [],
        removed: [],
        totals: { left: 3, right: 3 },
      });
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
      const lines = diffBodyLines(result.stdout);
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

    it('exits 2 when only one positional argument is given (right side has no target)', async () => {
      const result = await runCli([
        'diff',
        '--quiet',
        diffFixture('domain.ttl'),
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/registry is empty|no target source/i);
    });

    it('exits 2 when more than two positional arguments are given', async () => {
      const result = await runCli([
        'diff',
        '--quiet',
        'x.ttl',
        'y.ttl',
        'z.ttl',
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/at most two/);
    });

    it('exits 2 on an unknown --graph-mode value', async () => {
      const result = await runCli([
        'diff',
        '--quiet',
        '--graph-mode=bogus',
        diffFixture('domain.ttl'),
        diffFixture('domain.ttl'),
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/unknown.*--graph-mode/i);
    });
  });

  describe('config integration', () => {
    it('reads left and right from --config', async () => {
      const configPath = join(scratch, 'sparqly.diff.yaml');
      await writeFile(
        configPath,
        dedent`
          left: "${diffFixture('domain.ttl')}"
          right: "${diffFixture('parts/*.ttl')}"
        ` + '\n',
      );

      const result = await runCli([
        'diff',
        '--quiet',
        '--config',
        configPath,
      ]);

      expect(result.exitCode).toBe(0);
      expect(diffBodyLines(result.stdout)).toEqual([]);
      expect(result.stdout).toMatch(/^# left=\d+ right=\d+ \+0 -0\n$/);
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

  });
});
