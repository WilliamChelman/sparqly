import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import { HashCommand } from './hash.command';

describe('HashCommand.run', () => {
  let dir: string;
  let stdout: MockInstance<typeof process.stdout.write>;
  let stderr: MockInstance<typeof process.stderr.write>;
  let originalExitCode: number | string | null | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-hash-'));
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

  it('prints "<sha256>  <source-spec>\\n" and exits 0 for a single ttl source', async () => {
    const file = join(dir, 'domain.ttl');
    await writeFile(
      file,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
    );

    const cmd = new HashCommand();
    await cmd.run([file], { quiet: true });

    const out = stdoutText();
    expect(out).toMatch(/^[0-9a-f]{64} {2}/);
    expect(out.endsWith(`  ${file}\n`)).toBe(true);
    expect(process.exitCode).toBeFalsy();
  });

  it('round-trip: a single ttl and its split parts produce the same hash', async () => {
    const single = join(dir, 'domain.ttl');
    await writeFile(
      single,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:a ex:p ex:b .',
        'ex:c ex:q ex:d .',
        'ex:e ex:r ex:f .',
        '',
      ].join('\n'),
    );

    const partsDir = join(dir, 'parts');
    await mkdir(partsDir);
    await writeFile(
      join(partsDir, 'one.ttl'),
      '@prefix ex: <http://example.org/> . ex:c ex:q ex:d .\n',
    );
    await writeFile(
      join(partsDir, 'two.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
    );
    await writeFile(
      join(partsDir, 'three.ttl'),
      '@prefix ex: <http://example.org/> . ex:e ex:r ex:f .\n',
    );

    const cmdA = new HashCommand();
    await cmdA.run([single], { quiet: true });
    const hashA = stdoutText().split('  ')[0];

    stdout.mockClear();
    process.exitCode = undefined;

    const cmdB = new HashCommand();
    await cmdB.run([join(partsDir, '*.ttl')], { quiet: true });
    const hashB = stdoutText().split('  ')[0];

    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
    expect(hashB).toBe(hashA);
  });

  it('hash is invariant under blank-node relabeling, ordering, prefix, and whitespace', async () => {
    const a = join(dir, 'a.ttl');
    await writeFile(
      a,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:s ex:p _:b1 .',
        '_:b1 ex:q "v" .',
        'ex:x ex:y ex:z .',
        '',
      ].join('\n'),
    );
    const b = join(dir, 'b.ttl');
    await writeFile(
      b,
      [
        '@prefix other: <http://example.org/> .',
        '',
        '   other:x   other:y   other:z   .',
        '_:differentLabel    other:q    "v"   .',
        'other:s other:p _:differentLabel .',
        '',
      ].join('\n'),
    );

    const cmdA = new HashCommand();
    await cmdA.run([a], { quiet: true });
    const hashA = stdoutText().split('  ')[0];

    stdout.mockClear();
    process.exitCode = undefined;

    const cmdB = new HashCommand();
    await cmdB.run([b], { quiet: true });
    const hashB = stdoutText().split('  ')[0];

    expect(hashB).toBe(hashA);
  });

  it('all loader-supported formats produce a hash', async () => {
    const triples = '<http://example.org/a> <http://example.org/p> <http://example.org/b> .\n';
    const turtle = join(dir, 'data.ttl');
    await writeFile(turtle, triples);
    const ntriples = join(dir, 'data.nt');
    await writeFile(ntriples, triples);
    const nquads = join(dir, 'data.nq');
    await writeFile(nquads, triples);
    const trig = join(dir, 'data.trig');
    await writeFile(
      trig,
      '@prefix ex: <http://example.org/> . { ex:a ex:p ex:b . }\n',
    );
    const jsonld = join(dir, 'data.jsonld');
    await writeFile(
      jsonld,
      JSON.stringify({
        '@id': 'http://example.org/a',
        'http://example.org/p': { '@id': 'http://example.org/b' },
      }),
    );
    const rdfxml = join(dir, 'data.rdf');
    await writeFile(
      rdfxml,
      [
        '<?xml version="1.0"?>',
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:ex="http://example.org/">',
        '  <rdf:Description rdf:about="http://example.org/a">',
        '    <ex:p rdf:resource="http://example.org/b"/>',
        '  </rdf:Description>',
        '</rdf:RDF>',
        '',
      ].join('\n'),
    );

    for (const file of [turtle, ntriples, nquads, trig, jsonld, rdfxml]) {
      stdout.mockClear();
      process.exitCode = undefined;
      const cmd = new HashCommand();
      await cmd.run([file], { quiet: true });
      expect(stdoutText()).toMatch(/^[0-9a-f]{64} {2}/);
      expect(process.exitCode).toBeFalsy();
    }
  });

  it('honors --graph-strategy=none: a .trig source flattens to the same hash as the equivalent .ttl', async () => {
    const trig = join(dir, 'data.trig');
    await writeFile(
      trig,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:g1 { ex:a ex:p ex:b . }',
        'ex:g2 { ex:c ex:q ex:d . }',
        '',
      ].join('\n'),
    );
    const ttl = join(dir, 'data.ttl');
    await writeFile(
      ttl,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:a ex:p ex:b .',
        'ex:c ex:q ex:d .',
        '',
      ].join('\n'),
    );

    const cmdA = new HashCommand();
    await cmdA.run([trig], { graphStrategy: 'none', quiet: true });
    const hashTrig = stdoutText().split('  ')[0];

    stdout.mockClear();
    process.exitCode = undefined;

    const cmdB = new HashCommand();
    await cmdB.run([ttl], { quiet: true });
    const hashTtl = stdoutText().split('  ')[0];

    expect(hashTrig).toBe(hashTtl);
  });

  it('exits non-zero when the glob matches no files (no stdout)', async () => {
    const cmd = new HashCommand();
    await cmd.run([join(dir, 'nope-*.ttl')], { quiet: true });

    expect(process.exitCode).toBe(1);
    expect(stdoutText()).toBe('');
    expect(stderrText()).toMatch(/no files/i);
  });

  it('exits non-zero on a parse error and writes nothing to stdout', async () => {
    const bad = join(dir, 'broken.ttl');
    await writeFile(bad, 'this is not valid turtle <<<');

    const cmd = new HashCommand();
    await cmd.run([bad], { quiet: true });

    expect(process.exitCode).toBe(1);
    expect(stdoutText()).toBe('');
    expect(stderrText()).toMatch(/broken\.ttl/);
  });

  it('exits non-zero on an unknown --graph-strategy value', async () => {
    const cmd = new HashCommand();
    await cmd.run([join(dir, '*.ttl')], {
      graphStrategy: 'bogus',
      quiet: true,
    });

    expect(process.exitCode).toBe(1);
    expect(stderrText()).toMatch(/unknown.*--graph-strategy/i);
  });

  it('exits non-zero when no sources are provided', async () => {
    const cmd = new HashCommand();
    await cmd.run([], { quiet: true });

    expect(process.exitCode).toBe(1);
    expect(stderrText()).toMatch(/sources/i);
  });

  describe('config integration', () => {
    it('uses sources from --config when no CLI override is given', async () => {
      const file = join(dir, 'data.ttl');
      await writeFile(
        file,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );
      const configPath = join(dir, 'sparqly.config.yaml');
      await writeFile(
        configPath,
        ['hash:', `  sources: "${file}"`, ''].join('\n'),
      );

      const cmd = new HashCommand();
      await cmd.run([], { config: configPath, quiet: true });

      expect(stdoutText()).toMatch(/^[0-9a-f]{64} {2}/);
      expect(process.exitCode).toBeFalsy();
    });

    it('--print-config emits the hash block annotated with sources', async () => {
      const configPath = join(dir, 'sparqly.config.yaml');
      await writeFile(
        configPath,
        ['hash:', '  sources: "from-file/**/*.ttl"', ''].join('\n'),
      );

      const cmd = new HashCommand();
      await cmd.run([], {
        config: configPath,
        printConfig: true,
        graphStrategy: 'none',
        quiet: true,
      });

      const out = stdoutText();
      expect(out).toContain('# sparqly hash --print-config');
      expect(out).toMatch(/sources\s*:\s*"from-file\/\*\*\/\*\.ttl"\s+# file/);
      expect(out).toMatch(/graphStrategy\s*:\s*"none"\s+# flag/);
      expect(process.exitCode).toBeFalsy();
    });
  });

  describe('--compare-with mode', () => {
    async function writeDomain(path: string): Promise<void> {
      await writeFile(
        path,
        [
          '@prefix ex: <http://example.org/> .',
          'ex:a ex:p ex:b .',
          'ex:c ex:q ex:d .',
          'ex:e ex:r ex:f .',
          '',
        ].join('\n'),
      );
    }

    async function writeCleanSplit(partsDir: string): Promise<void> {
      await mkdir(partsDir);
      await writeFile(
        join(partsDir, 'one.ttl'),
        '@prefix ex: <http://example.org/> . ex:c ex:q ex:d .\n',
      );
      await writeFile(
        join(partsDir, 'two.ttl'),
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );
      await writeFile(
        join(partsDir, 'three.ttl'),
        '@prefix ex: <http://example.org/> . ex:e ex:r ex:f .\n',
      );
    }

    it('prints "match: <hash>" and exits 0 on a clean split', async () => {
      const single = join(dir, 'domain.ttl');
      await writeDomain(single);
      const partsDir = join(dir, 'parts');
      await writeCleanSplit(partsDir);
      const partsGlob = join(partsDir, '*.ttl');

      const cmd = new HashCommand();
      await cmd.run([single], { compareWith: partsGlob, quiet: true });

      const out = stdoutText();
      expect(out).toMatch(/^match: [0-9a-f]{64}\n$/);
      expect(process.exitCode).toBeFalsy();
    });

    it('prints both labeled hashes and exits 1 on mismatch', async () => {
      const single = join(dir, 'domain.ttl');
      await writeDomain(single);

      const driftDir = join(dir, 'drift');
      await mkdir(driftDir);
      await writeFile(
        join(driftDir, 'one.ttl'),
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );
      await writeFile(
        join(driftDir, 'two.ttl'),
        '@prefix ex: <http://example.org/> . ex:c ex:q ex:d .\n',
      );
      const driftGlob = join(driftDir, '*.ttl');

      const cmd = new HashCommand();
      await cmd.run([single], { compareWith: driftGlob, quiet: true });

      const out = stdoutText();
      const lines = out.split('\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(
        new RegExp(`^[0-9a-f]{64} {2}${escapeRe(single)}$`),
      );
      expect(lines[1]).toMatch(
        new RegExp(`^[0-9a-f]{64} {2}${escapeRe(driftGlob)}$`),
      );
      const hashA = lines[0].split('  ')[0];
      const hashB = lines[1].split('  ')[0];
      expect(hashA).not.toBe(hashB);
      expect(process.exitCode).toBe(1);
    });

    it('exits 2 when the primary source fails to parse', async () => {
      const bad = join(dir, 'broken.ttl');
      await writeFile(bad, 'this is not valid turtle <<<');
      const good = join(dir, 'good.ttl');
      await writeFile(
        good,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );

      const cmd = new HashCommand();
      await cmd.run([bad], { compareWith: good, quiet: true });

      expect(process.exitCode).toBe(2);
      expect(stdoutText()).toBe('');
      expect(stderrText()).toMatch(/broken\.ttl/);
    });

    it('exits 2 when --compare-with source fails to parse', async () => {
      const good = join(dir, 'good.ttl');
      await writeFile(
        good,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );
      const bad = join(dir, 'broken.ttl');
      await writeFile(bad, 'this is not valid turtle <<<');

      const cmd = new HashCommand();
      await cmd.run([good], { compareWith: bad, quiet: true });

      expect(process.exitCode).toBe(2);
      expect(stdoutText()).toBe('');
      expect(stderrText()).toMatch(/broken\.ttl/);
    });

    it('exits 2 when no primary source is provided', async () => {
      const compareTarget = join(dir, 'a.ttl');
      await writeFile(
        compareTarget,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );

      const cmd = new HashCommand();
      await cmd.run([], { compareWith: compareTarget, quiet: true });

      expect(process.exitCode).toBe(2);
      expect(stdoutText()).toBe('');
      expect(stderrText()).toMatch(/--compare-with.*one primary source/);
    });

    it('exits 2 when multiple primary sources are provided', async () => {
      const a = join(dir, 'a.ttl');
      const b = join(dir, 'b.ttl');
      await writeFile(
        a,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );
      await writeFile(
        b,
        '@prefix ex: <http://example.org/> . ex:c ex:q ex:d .\n',
      );

      const cmd = new HashCommand();
      await cmd.run([], { sources: [a, b], compareWith: a, quiet: true });

      expect(process.exitCode).toBe(2);
      expect(stdoutText()).toBe('');
      expect(stderrText()).toMatch(/--compare-with.*one primary source/);
    });

    it('applies --graph-strategy=none to both sides so a .trig matches the same .ttl', async () => {
      const trig = join(dir, 'data.trig');
      await writeFile(
        trig,
        [
          '@prefix ex: <http://example.org/> .',
          'ex:g1 { ex:a ex:p ex:b . }',
          'ex:g2 { ex:c ex:q ex:d . }',
          '',
        ].join('\n'),
      );
      const ttl = join(dir, 'data.ttl');
      await writeFile(
        ttl,
        [
          '@prefix ex: <http://example.org/> .',
          'ex:a ex:p ex:b .',
          'ex:c ex:q ex:d .',
          '',
        ].join('\n'),
      );

      const cmd = new HashCommand();
      await cmd.run([trig], {
        compareWith: ttl,
        graphStrategy: 'none',
        quiet: true,
      });

      expect(stdoutText()).toMatch(/^match: [0-9a-f]{64}\n$/);
      expect(process.exitCode).toBeFalsy();
    });

    it('exits 2 on an unknown --graph-strategy value', async () => {
      const a = join(dir, 'a.ttl');
      await writeFile(
        a,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );

      const cmd = new HashCommand();
      await cmd.run([a], {
        compareWith: a,
        graphStrategy: 'bogus',
        quiet: true,
      });

      expect(process.exitCode).toBe(2);
      expect(stderrText()).toMatch(/unknown.*--graph-strategy/i);
    });

    it('SPARQLY_HASH_COMPARE_WITH env triggers compare mode', async () => {
      const single = join(dir, 'domain.ttl');
      await writeDomain(single);
      const partsDir = join(dir, 'parts');
      await writeCleanSplit(partsDir);
      const partsGlob = join(partsDir, '*.ttl');

      const original = process.env['SPARQLY_HASH_COMPARE_WITH'];
      process.env['SPARQLY_HASH_COMPARE_WITH'] = partsGlob;
      try {
        const cmd = new HashCommand();
        await cmd.run([single], { quiet: true });
      } finally {
        if (original === undefined)
          delete process.env['SPARQLY_HASH_COMPARE_WITH'];
        else process.env['SPARQLY_HASH_COMPARE_WITH'] = original;
      }

      expect(stdoutText()).toMatch(/^match: [0-9a-f]{64}\n$/);
      expect(process.exitCode).toBeFalsy();
    });

    it('hash.compareWith in the config file triggers compare mode', async () => {
      const single = join(dir, 'domain.ttl');
      await writeDomain(single);
      const partsDir = join(dir, 'parts');
      await writeCleanSplit(partsDir);
      const partsGlob = join(partsDir, '*.ttl');

      const configPath = join(dir, 'sparqly.config.yaml');
      await writeFile(
        configPath,
        [
          'hash:',
          `  sources: "${single}"`,
          `  compareWith: "${partsGlob}"`,
          '',
        ].join('\n'),
      );

      const cmd = new HashCommand();
      await cmd.run([], { config: configPath, quiet: true });

      expect(stdoutText()).toMatch(/^match: [0-9a-f]{64}\n$/);
      expect(process.exitCode).toBeFalsy();
    });
  });

  describe('--json output format', () => {
    it('--json prints a JSON array of {source, hash} for a single source', async () => {
      const file = join(dir, 'a.ttl');
      await writeFile(
        file,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );

      const cmd = new HashCommand();
      await cmd.run([file], { json: true, quiet: true });

      const out = stdoutText();
      expect(out.endsWith('\n')).toBe(true);
      const parsed = JSON.parse(out);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].source).toBe(file);
      expect(parsed[0].hash).toMatch(/^[0-9a-f]{64}$/);
      expect(process.exitCode).toBeFalsy();
    });

    it('--json preserves input order for multiple --sources', async () => {
      const a = join(dir, 'a.ttl');
      const b = join(dir, 'b.ttl');
      await writeFile(
        a,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );
      await writeFile(
        b,
        '@prefix ex: <http://example.org/> . ex:c ex:q ex:d .\n',
      );

      const cmd = new HashCommand();
      await cmd.run([], { sources: [b, a], json: true, quiet: true });

      const parsed = JSON.parse(stdoutText());
      expect(parsed).toHaveLength(2);
      expect(parsed[0].source).toBe(b);
      expect(parsed[1].source).toBe(a);
      expect(parsed[0].hash).toMatch(/^[0-9a-f]{64}$/);
      expect(parsed[1].hash).toMatch(/^[0-9a-f]{64}$/);
      expect(process.exitCode).toBeFalsy();
    });

    it('SPARQLY_HASH_JSON=true is equivalent to --json', async () => {
      const file = join(dir, 'env.ttl');
      await writeFile(
        file,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );

      const original = process.env['SPARQLY_HASH_JSON'];
      process.env['SPARQLY_HASH_JSON'] = 'true';
      try {
        const cmd = new HashCommand();
        await cmd.run([file], { quiet: true });
      } finally {
        if (original === undefined) delete process.env['SPARQLY_HASH_JSON'];
        else process.env['SPARQLY_HASH_JSON'] = original;
      }

      const parsed = JSON.parse(stdoutText());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].source).toBe(file);
      expect(parsed[0].hash).toMatch(/^[0-9a-f]{64}$/);
      expect(process.exitCode).toBeFalsy();
    });

    it('hash.json: true in the config file is equivalent to --json', async () => {
      const file = join(dir, 'data.ttl');
      await writeFile(
        file,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );
      const configPath = join(dir, 'sparqly.config.yaml');
      await writeFile(
        configPath,
        ['hash:', `  sources: "${file}"`, '  json: true', ''].join('\n'),
      );

      const cmd = new HashCommand();
      await cmd.run([], { config: configPath, quiet: true });

      const parsed = JSON.parse(stdoutText());
      expect(parsed).toHaveLength(1);
      expect(parsed[0].source).toBe(file);
      expect(parsed[0].hash).toMatch(/^[0-9a-f]{64}$/);
      expect(process.exitCode).toBeFalsy();
    });

    it('writes nothing to stdout when a source fails to parse under --json', async () => {
      const good = join(dir, 'good.ttl');
      const bad = join(dir, 'broken.ttl');
      await writeFile(
        good,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );
      await writeFile(bad, 'this is not valid turtle <<<');

      const cmd = new HashCommand();
      await cmd.run([], {
        sources: [good, bad],
        json: true,
        quiet: true,
      });

      expect(process.exitCode).toBe(1);
      expect(stdoutText()).toBe('');
      expect(stderrText()).toMatch(/broken\.ttl/);
    });
  });

  describe('--out', () => {
    it('writes the default <hash>  <source> line to the file (byte-identical to stdout) and leaves stdout empty', async () => {
      const file = join(dir, 'data.ttl');
      await writeFile(
        file,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );

      const cmdBaseline = new HashCommand();
      await cmdBaseline.run([file], { quiet: true });
      const stdoutBaseline = stdoutText();

      stdout.mockClear();
      stderr.mockClear();
      process.exitCode = undefined;

      const target = join(dir, 'hashes.txt');
      const cmd = new HashCommand();
      await cmd.run([file], { out: target, quiet: true });

      expect(stdoutText()).toBe('');
      const written = await readFile(target, 'utf8');
      expect(written).toBe(stdoutBaseline);
      expect(process.exitCode).toBeFalsy();
    });

    it('byte-parity for --json mode', async () => {
      const file = join(dir, 'data.ttl');
      await writeFile(
        file,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );

      const cmdBaseline = new HashCommand();
      await cmdBaseline.run([file], { json: true, quiet: true });
      const stdoutBaseline = stdoutText();

      stdout.mockClear();
      stderr.mockClear();
      process.exitCode = undefined;

      const target = join(dir, 'hashes.json');
      const cmd = new HashCommand();
      await cmd.run([file], { json: true, out: target, quiet: true });

      expect(stdoutText()).toBe('');
      expect(await readFile(target, 'utf8')).toBe(stdoutBaseline);
      expect(process.exitCode).toBeFalsy();
    });

    it('writes all results in input order for multiple --sources', async () => {
      const a = join(dir, 'a.ttl');
      const b = join(dir, 'b.ttl');
      await writeFile(
        a,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );
      await writeFile(
        b,
        '@prefix ex: <http://example.org/> . ex:c ex:q ex:d .\n',
      );

      const cmdBaseline = new HashCommand();
      await cmdBaseline.run([], { sources: [b, a], quiet: true });
      const stdoutBaseline = stdoutText();

      stdout.mockClear();
      stderr.mockClear();
      process.exitCode = undefined;

      const target = join(dir, 'multi.txt');
      const cmd = new HashCommand();
      await cmd.run([], { sources: [b, a], out: target, quiet: true });

      expect(stdoutText()).toBe('');
      const written = await readFile(target, 'utf8');
      expect(written).toBe(stdoutBaseline);
      const lines = written.split('\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(2);
      expect(lines[0].endsWith(`  ${b}`)).toBe(true);
      expect(lines[1].endsWith(`  ${a}`)).toBe(true);
      expect(process.exitCode).toBeFalsy();
    });

    it('rejects --out combined with --compare-with with exit 2 and clear error', async () => {
      const a = join(dir, 'a.ttl');
      await writeFile(
        a,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );

      const target = join(dir, 'compare.txt');
      const cmd = new HashCommand();
      await cmd.run([a], { compareWith: a, out: target, quiet: true });

      expect(process.exitCode).toBe(2);
      expect(stdoutText()).toBe('');
      expect(stderrText()).toMatch(/--out.*--compare-with/);
    });
  });

  describe('multiple --sources', () => {
    it('prints one line per --sources flag in input order', async () => {
      const a = join(dir, 'a.ttl');
      const b = join(dir, 'b.ttl');
      await writeFile(
        a,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );
      await writeFile(
        b,
        '@prefix ex: <http://example.org/> . ex:c ex:q ex:d .\n',
      );

      const cmd = new HashCommand();
      await cmd.run([], { sources: [a, b], quiet: true });

      const out = stdoutText();
      const lines = out.split('\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(new RegExp(`^[0-9a-f]{64} {2}${escapeRe(a)}$`));
      expect(lines[1]).toMatch(new RegExp(`^[0-9a-f]{64} {2}${escapeRe(b)}$`));
      expect(process.exitCode).toBeFalsy();
    });

    it('a glob within a single --sources is merged into one hash', async () => {
      const single = join(dir, 'domain.ttl');
      await writeFile(
        single,
        [
          '@prefix ex: <http://example.org/> .',
          'ex:a ex:p ex:b .',
          'ex:c ex:q ex:d .',
          '',
        ].join('\n'),
      );

      const partsDir = join(dir, 'parts');
      await mkdir(partsDir);
      await writeFile(
        join(partsDir, 'one.ttl'),
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );
      await writeFile(
        join(partsDir, 'two.ttl'),
        '@prefix ex: <http://example.org/> . ex:c ex:q ex:d .\n',
      );

      const cmdSingle = new HashCommand();
      await cmdSingle.run([single], { quiet: true });
      const hashSingle = stdoutText().split('  ')[0];

      stdout.mockClear();
      process.exitCode = undefined;

      const glob = join(partsDir, '*.ttl');
      const cmdGlob = new HashCommand();
      await cmdGlob.run([], { sources: [glob], quiet: true });

      const out = stdoutText();
      const lines = out.split('\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(`${hashSingle}  ${glob}`);
    });

    it('one bad source out of N aborts the whole command with no stdout', async () => {
      const good = join(dir, 'good.ttl');
      const bad = join(dir, 'broken.ttl');
      await writeFile(
        good,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );
      await writeFile(bad, 'this is not valid turtle <<<');

      const cmd = new HashCommand();
      await cmd.run([], { sources: [good, bad], quiet: true });

      expect(process.exitCode).toBe(1);
      expect(stdoutText()).toBe('');
      expect(stderrText()).toMatch(/broken\.ttl/);
    });

    it('hash.sources accepts an array in the config file', async () => {
      const a = join(dir, 'a.ttl');
      const b = join(dir, 'b.ttl');
      await writeFile(
        a,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );
      await writeFile(
        b,
        '@prefix ex: <http://example.org/> . ex:c ex:q ex:d .\n',
      );

      const configPath = join(dir, 'sparqly.config.yaml');
      await writeFile(
        configPath,
        ['hash:', '  sources:', `    - "${a}"`, `    - "${b}"`, ''].join('\n'),
      );

      const cmd = new HashCommand();
      await cmd.run([], { config: configPath, quiet: true });

      const lines = stdoutText().split('\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(2);
      expect(lines[0].endsWith(`  ${a}`)).toBe(true);
      expect(lines[1].endsWith(`  ${b}`)).toBe(true);
      expect(process.exitCode).toBeFalsy();
    });

    it('SPARQLY_HASH_SOURCES env var still works for the single-source case', async () => {
      const file = join(dir, 'env.ttl');
      await writeFile(
        file,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );

      const original = process.env['SPARQLY_HASH_SOURCES'];
      process.env['SPARQLY_HASH_SOURCES'] = file;
      try {
        const cmd = new HashCommand();
        await cmd.run([], { quiet: true });
      } finally {
        if (original === undefined) delete process.env['SPARQLY_HASH_SOURCES'];
        else process.env['SPARQLY_HASH_SOURCES'] = original;
      }

      const lines = stdoutText().split('\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(new RegExp(`^[0-9a-f]{64} {2}${escapeRe(file)}$`));
      expect(process.exitCode).toBeFalsy();
    });
  });
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
