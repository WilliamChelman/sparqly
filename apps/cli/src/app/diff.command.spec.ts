import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { DiffCommand } from './diff.command';

describe('DiffCommand.run', () => {
  let dir: string;
  let stdout: MockInstance<typeof process.stdout.write>;
  let stderr: MockInstance<typeof process.stderr.write>;
  let originalExitCode: number | string | null | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-diff-'));
    stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(async () => {
    stdout.mockRestore();
    stderr.mockRestore();
    process.exitCode = originalExitCode;
    await rm(dir, { recursive: true, force: true });
  });

  function joinCalls(spy: MockInstance<typeof process.stdout.write>): string {
    return spy.mock.calls
      .map((args) => {
        const chunk = (args as unknown[])[0] as string | Buffer | undefined;
        if (chunk == null) return '';
        return typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      })
      .join('');
  }

  const stdoutText = (): string => joinCalls(stdout);
  const stderrText = (): string => joinCalls(stderr);

  async function writeFiles(
    entries: ReadonlyArray<readonly [string, string]>,
  ): Promise<void> {
    for (const [name, body] of entries) {
      await writeFile(join(dir, name), body);
    }
  }

  it('exits 0 with empty stdout when sources are semantically identical', async () => {
    await writeFiles([
      ['a.ttl', '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n'],
      ['b.ttl', '@prefix other: <http://example.org/> . other:a other:p other:b .\n'],
    ]);

    const cmd = new DiffCommand();
    await cmd.run([join(dir, 'a.ttl'), join(dir, 'b.ttl')], { quiet: true });

    expect(stdoutText()).toBe('');
    expect(process.exitCode).toBe(0);
  });

  it('exits 1 and prints removed-then-added human-format lines on a diff', async () => {
    await writeFiles([
      [
        'left.ttl',
        '@prefix ex: <http://example.org/> .\nex:a ex:p ex:b .\nex:c ex:q ex:d .\n',
      ],
      [
        'right.ttl',
        '@prefix ex: <http://example.org/> .\nex:a ex:p ex:b .\nex:e ex:r ex:f .\n',
      ],
    ]);

    const cmd = new DiffCommand();
    await cmd.run([join(dir, 'left.ttl'), join(dir, 'right.ttl')], {
      quiet: true,
    });

    const out = stdoutText();
    expect(process.exitCode).toBe(1);
    expect(out).toMatch(
      /^- <http:\/\/example\.org\/c> <http:\/\/example\.org\/q> <http:\/\/example\.org\/d> \.\n\+ <http:\/\/example\.org\/e> <http:\/\/example\.org\/r> <http:\/\/example\.org\/f> \.\n$/,
    );
  });

  it('writes the "# +<added> -<removed>" summary to stderr by default and suppresses with --quiet', async () => {
    await writeFiles([
      ['left.ttl', '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n'],
      [
        'right.ttl',
        '@prefix ex: <http://example.org/> .\nex:a ex:p ex:b .\nex:c ex:q ex:d .\n',
      ],
    ]);

    const cmd = new DiffCommand();
    await cmd.run([join(dir, 'left.ttl'), join(dir, 'right.ttl')], {});

    expect(stderrText()).toContain('# +1 -0\n');

    stdout.mockClear();
    stderr.mockClear();
    process.exitCode = undefined;

    const cmd2 = new DiffCommand();
    await cmd2.run([join(dir, 'left.ttl'), join(dir, 'right.ttl')], {
      quiet: true,
    });
    expect(stderrText()).not.toContain('# +');
  });

  it('is invariant under blank-node relabeling, statement order, prefix, and whitespace', async () => {
    await writeFiles([
      [
        'left.ttl',
        [
          '@prefix ex: <http://example.org/> .',
          'ex:s ex:p _:b1 .',
          '_:b1 ex:q "v" .',
          'ex:x ex:y ex:z .',
          '',
        ].join('\n'),
      ],
      [
        'right.ttl',
        [
          '@prefix other: <http://example.org/> .',
          '',
          '   other:x   other:y   other:z   .',
          '_:differentLabel    other:q    "v"   .',
          'other:s other:p _:differentLabel .',
          '',
        ].join('\n'),
      ],
    ]);

    const cmd = new DiffCommand();
    await cmd.run([join(dir, 'left.ttl'), join(dir, 'right.ttl')], {
      quiet: true,
    });

    expect(stdoutText()).toBe('');
    expect(process.exitCode).toBe(0);
  });

  it('treats graph names as part of statement identity by default for quad sources', async () => {
    await writeFiles([
      [
        'left.trig',
        '@prefix ex: <http://example.org/> .\nex:g1 { ex:a ex:p ex:b . }\n',
      ],
      [
        'right.trig',
        '@prefix ex: <http://example.org/> .\nex:g2 { ex:a ex:p ex:b . }\n',
      ],
    ]);

    const cmd = new DiffCommand();
    await cmd.run([join(dir, 'left.trig'), join(dir, 'right.trig')], {
      quiet: true,
    });

    const out = stdoutText();
    expect(process.exitCode).toBe(1);
    const lines = out.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith('- ')).toBe(true);
    expect(lines[1].startsWith('+ ')).toBe(true);
    expect(out).toContain('<http://example.org/g1>');
    expect(out).toContain('<http://example.org/g2>');
  });

  it('--graph-strategy=none flattens quads and ignores graph mismatch', async () => {
    await writeFiles([
      [
        'left.trig',
        '@prefix ex: <http://example.org/> .\nex:g1 { ex:a ex:p ex:b . }\n',
      ],
      [
        'right.trig',
        '@prefix ex: <http://example.org/> .\nex:g2 { ex:a ex:p ex:b . }\n',
      ],
    ]);

    const cmd = new DiffCommand();
    await cmd.run([join(dir, 'left.trig'), join(dir, 'right.trig')], {
      graphStrategy: 'none',
      quiet: true,
    });

    expect(stdoutText()).toBe('');
    expect(process.exitCode).toBe(0);
  });

  describe('--format json', () => {
    it('emits {added, removed} of {s,p,o} term objects', async () => {
      await writeFiles([
        ['left.ttl', '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n'],
        [
          'right.ttl',
          '@prefix ex: <http://example.org/> .\nex:a ex:p ex:b .\nex:c ex:q "hi"@en .\n',
        ],
      ]);

      const cmd = new DiffCommand();
      await cmd.run([join(dir, 'left.ttl'), join(dir, 'right.ttl')], {
        format: 'json',
        quiet: true,
      });

      expect(process.exitCode).toBe(1);
      const parsed = JSON.parse(stdoutText());
      expect(parsed.removed).toEqual([]);
      expect(parsed.added).toHaveLength(1);
      expect(parsed.added[0].s).toEqual({
        termType: 'NamedNode',
        value: 'http://example.org/c',
      });
      expect(parsed.added[0].p).toEqual({
        termType: 'NamedNode',
        value: 'http://example.org/q',
      });
      expect(parsed.added[0].o.termType).toBe('Literal');
      expect(parsed.added[0].o.value).toBe('hi');
      expect(parsed.added[0].o.language).toBe('en');
      expect(parsed.added[0].g).toBeUndefined();
    });

    it('emits a graph component when statements live outside the default graph', async () => {
      await writeFiles([
        [
          'left.trig',
          '@prefix ex: <http://example.org/> . ex:g1 { ex:a ex:p ex:b . }\n',
        ],
        ['right.ttl', '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n'],
      ]);

      const cmd = new DiffCommand();
      await cmd.run([join(dir, 'left.trig'), join(dir, 'right.ttl')], {
        format: 'json',
        quiet: true,
      });

      const parsed = JSON.parse(stdoutText());
      expect(parsed.removed).toHaveLength(1);
      expect(parsed.removed[0].g).toEqual({
        termType: 'NamedNode',
        value: 'http://example.org/g1',
      });
      expect(parsed.added).toHaveLength(1);
      expect(parsed.added[0].g).toBeUndefined();
    });

    it('emits {"added":[],"removed":[]} when sources are identical', async () => {
      await writeFiles([
        ['a.ttl', '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n'],
      ]);

      const cmd = new DiffCommand();
      await cmd.run([join(dir, 'a.ttl'), join(dir, 'a.ttl')], {
        format: 'json',
        quiet: true,
      });

      expect(process.exitCode).toBe(0);
      expect(JSON.parse(stdoutText())).toEqual({ added: [], removed: [] });
    });
  });

  describe('--format rdf-patch', () => {
    it('emits standard RDF Patch with D-then-A markers', async () => {
      await writeFiles([
        [
          'left.ttl',
          '@prefix ex: <http://example.org/> .\nex:a ex:p ex:b .\nex:c ex:q ex:d .\n',
        ],
        [
          'right.ttl',
          '@prefix ex: <http://example.org/> .\nex:a ex:p ex:b .\nex:e ex:r ex:f .\n',
        ],
      ]);

      const cmd = new DiffCommand();
      await cmd.run([join(dir, 'left.ttl'), join(dir, 'right.ttl')], {
        format: 'rdf-patch',
        quiet: true,
      });

      const out = stdoutText();
      expect(process.exitCode).toBe(1);
      const lines = out.split('\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^D /);
      expect(lines[1]).toMatch(/^A /);
    });
  });

  describe('exit codes', () => {
    it('exits 2 on a parse error in either side', async () => {
      const good = join(dir, 'good.ttl');
      const bad = join(dir, 'broken.ttl');
      await writeFile(
        good,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );
      await writeFile(bad, 'this is not valid turtle <<<');

      const cmd = new DiffCommand();
      await cmd.run([good, bad], { quiet: true });

      expect(process.exitCode).toBe(2);
      expect(stdoutText()).toBe('');
      expect(stderrText()).toMatch(/broken\.ttl/);
    });

    it('exits 2 when only one positional argument is given', async () => {
      const good = join(dir, 'a.ttl');
      await writeFile(
        good,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );

      const cmd = new DiffCommand();
      await cmd.run([good], { quiet: true });

      expect(process.exitCode).toBe(2);
      expect(stderrText()).toMatch(/two source specs/);
    });

    it('exits 2 when more than two positional arguments are given', async () => {
      const cmd = new DiffCommand();
      await cmd.run(['x.ttl', 'y.ttl', 'z.ttl'], { quiet: true });

      expect(process.exitCode).toBe(2);
      expect(stderrText()).toMatch(/at most two/);
    });

    it('exits 2 on an unknown --graph-strategy value', async () => {
      const cmd = new DiffCommand();
      await cmd.run(['a.ttl', 'b.ttl'], {
        graphStrategy: 'bogus',
        quiet: true,
      });

      expect(process.exitCode).toBe(2);
      expect(stderrText()).toMatch(/unknown.*--graph-strategy/i);
    });

    it('exits 2 on an unknown --format value', async () => {
      const cmd = new DiffCommand();
      await cmd.run(['a.ttl', 'b.ttl'], { format: 'bogus', quiet: true });

      expect(process.exitCode).toBe(2);
      expect(stderrText()).toMatch(/unknown.*--format/i);
    });
  });

  describe('config integration', () => {
    it('reads diff.left and diff.right from the config file', async () => {
      const left = join(dir, 'a.ttl');
      const right = join(dir, 'b.ttl');
      await writeFile(
        left,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );
      await writeFile(
        right,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );
      const configPath = join(dir, 'sparqly.config.yaml');
      await writeFile(
        configPath,
        ['diff:', `  left: "${left}"`, `  right: "${right}"`, ''].join('\n'),
      );

      const cmd = new DiffCommand();
      await cmd.run([], { config: configPath, quiet: true });

      expect(process.exitCode).toBe(0);
      expect(stdoutText()).toBe('');
    });

    it('SPARQLY_DIFF_FORMAT env triggers JSON output', async () => {
      const left = join(dir, 'a.ttl');
      const right = join(dir, 'b.ttl');
      await writeFile(
        left,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );
      await writeFile(
        right,
        '@prefix ex: <http://example.org/> .\nex:a ex:p ex:b .\nex:c ex:q ex:d .\n',
      );

      const original = process.env['SPARQLY_DIFF_FORMAT'];
      process.env['SPARQLY_DIFF_FORMAT'] = 'json';
      try {
        const cmd = new DiffCommand();
        await cmd.run([left, right], { quiet: true });
      } finally {
        if (original === undefined) delete process.env['SPARQLY_DIFF_FORMAT'];
        else process.env['SPARQLY_DIFF_FORMAT'] = original;
      }

      expect(process.exitCode).toBe(1);
      const parsed = JSON.parse(stdoutText());
      expect(parsed.added).toHaveLength(1);
      expect(parsed.removed).toEqual([]);
    });

    it('--print-config emits the diff block with default format=human', async () => {
      const cmd = new DiffCommand();
      await cmd.run(['x.ttl', 'y.ttl'], {
        printConfig: true,
        quiet: true,
      });

      const out = stdoutText();
      expect(out).toContain('# sparqly diff --print-config');
      expect(out).toMatch(/format\s*:\s*"human"\s+# default/);
      expect(out).toMatch(/left\s*:\s*"x\.ttl"\s+# flag/);
      expect(out).toMatch(/right\s*:\s*"y\.ttl"\s+# flag/);
      expect(process.exitCode).toBeFalsy();
    });
  });

  it('output is stable under sort: removed and added blocks are byte-identical across invocations', async () => {
    await writeFiles([
      [
        'left.ttl',
        [
          '@prefix ex: <http://example.org/> .',
          'ex:c ex:p ex:c2 .',
          'ex:a ex:p ex:a2 .',
          'ex:b ex:p ex:b2 .',
          '',
        ].join('\n'),
      ],
      [
        'right.ttl',
        '@prefix ex: <http://example.org/> .\nex:a ex:p ex:a2 .\n',
      ],
    ]);

    const cmd1 = new DiffCommand();
    await cmd1.run([join(dir, 'left.ttl'), join(dir, 'right.ttl')], {
      quiet: true,
    });
    const first = stdoutText();

    stdout.mockClear();
    process.exitCode = undefined;

    const cmd2 = new DiffCommand();
    await cmd2.run([join(dir, 'left.ttl'), join(dir, 'right.ttl')], {
      quiet: true,
    });
    const second = stdoutText();

    expect(first).toBe(second);
    const lines = first.split('\n').filter((l) => l.length > 0);
    const onlyRemoved = lines.map((l) => l.replace(/^- /, ''));
    expect([...onlyRemoved]).toEqual([...onlyRemoved].sort());
  });
});
