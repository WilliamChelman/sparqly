import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
});
