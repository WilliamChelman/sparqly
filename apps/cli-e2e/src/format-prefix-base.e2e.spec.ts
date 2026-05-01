import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { formatFixture } from './helpers/hash';

describe('sparqly format — config prefixes', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-format-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('config prefixes win over input-file prefixes; orphan input IRIs go full form', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      dedent`
        prefixes:
          ex: "http://override.example/"
      ` + '\n',
    );
    await writeFile(
      join(dir, 'data.ttl'),
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
      ` + '\n',
    );

    const result = await runCli(['format', 'data.ttl'], { cwd: dir });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    // Config takes the `ex` name with a different IRI; the file's IRIs
    // (http://example.org/...) lose their mapping and emit in full form.
    expect(result.stdout).not.toMatch(
      /@prefix ex: <http:\/\/example\.org\/>/,
    );
    expect(result.stdout).toContain('<http://example.org/a>');
  });

  it('config prefixes apply when input file declares no matching prefix', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      dedent`
        prefixes:
          ex: "http://example.org/"
      ` + '\n',
    );
    await writeFile(
      join(dir, 'data.ttl'),
      '<http://example.org/a> <http://example.org/p> <http://example.org/b> .\n',
    );

    const result = await runCli(['format', 'data.ttl'], { cwd: dir });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('@prefix ex: <http://example.org/>');
    expect(result.stdout).toContain('ex:a ex:p ex:b');
  });
});

describe('sparqly format — config base', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-format-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('emits @base from config and shortens matching IRIs to relative form', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      'base: "http://example.org/"\n',
    );
    await writeFile(
      join(dir, 'data.ttl'),
      '<http://example.org/a> <http://example.org/p> <http://example.org/b> .\n',
    );

    const result = await runCli(['format', 'data.ttl'], { cwd: dir });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(
      /^@base <http:\/\/example\.org\/>\s*\.$/m,
    );
    expect(result.stdout).not.toContain('<http://example.org/a>');
    expect(result.stdout).toContain('<a>');
  });

  it("honors the input file's @base when config has no base", async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      dedent`
        @base <http://example.org/> .
        <a> <p> <b> .
      ` + '\n',
    );

    const result = await runCli(['format', 'data.ttl'], { cwd: dir });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(
      /^@base <http:\/\/example\.org\/>\s*\.$/m,
    );
    expect(result.stdout).not.toContain('<http://example.org/a>');
    expect(result.stdout).toContain('<a>');
  });

  it('config base wins over the input file @base', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      'base: "http://config.example/"\n',
    );
    await writeFile(
      join(dir, 'data.ttl'),
      dedent`
        @base <http://file.example/> .
        <a> <p> <b> .
      ` + '\n',
    );

    const result = await runCli(['format', 'data.ttl'], { cwd: dir });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(
      /^@base <http:\/\/config\.example\/>\s*\.$/m,
    );
    // file IRIs resolve to http://file.example/{a,p,b}; they don't share the
    // config base, so they emit in full form.
    expect(result.stdout).toContain('<http://file.example/a>');
  });

  it('round-trips: parsing the formatted output yields the same triples', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      dedent`
        base: "http://example.org/"
        prefixes:
          rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
      ` + '\n',
    );
    await writeFile(
      join(dir, 'data.ttl'),
      dedent`
        <http://example.org/a>
          <http://www.w3.org/1999/02/22-rdf-syntax-ns#type>
          <http://example.org/Thing> ;
          <http://example.org/p> <http://example.org/b> .
      ` + '\n',
    );

    const result = await runCli(['format', 'data.ttl'], { cwd: dir });

    expect(result.exitCode).toBe(0);
    const { Parser } = await import('n3');
    const parsed = new Parser({
      format: 'text/turtle',
      baseIRI: 'http://example.org/',
    }).parse(result.stdout);
    expect(parsed.length).toBe(2);
    const subjects = new Set(parsed.map((q) => q.subject.value));
    expect(subjects).toEqual(new Set(['http://example.org/a']));
    const objects = new Set(parsed.map((q) => q.object.value));
    expect(objects).toEqual(
      new Set(['http://example.org/Thing', 'http://example.org/b']),
    );
  });
});

describe('sparqly format — --prefix CLI flag', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-format-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('CLI --prefix wins over config prefixes for the same name', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      dedent`
        prefixes:
          ex: "http://config.example/"
      ` + '\n',
    );
    await writeFile(
      join(dir, 'data.ttl'),
      '<http://cli.example/a> <http://cli.example/p> <http://cli.example/b> .\n',
    );

    const result = await runCli(
      ['format', '--prefix', 'ex=http://cli.example/', 'data.ttl'],
      { cwd: dir },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('@prefix ex: <http://cli.example/>');
    expect(result.stdout).toContain('ex:a ex:p ex:b');
    expect(result.stdout).not.toContain('http://config.example/');
  });

  it('repeatable --prefix name=<iri> introduces a CURIE for matching IRIs', async () => {
    const stdin =
      '<http://other.example/a> <http://other.example/p> <http://other.example/b> .\n';

    const result = await runCli(
      ['format', '--prefix', 'oth=http://other.example/'],
      { stdin },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('@prefix oth: <http://other.example/>');
    expect(result.stdout).toContain('oth:a oth:p oth:b');
    expect(result.stdout).not.toContain('<http://other.example/a>');
  });

  it('CLI --prefix overrides config and file prefixes (highest precedence)', async () => {
    const result = await runCli(
      [
        'format',
        '--prefix',
        'ex=http://override.example/',
        formatFixture('simple.ttl'),
      ],
    );

    expect(result.exitCode).toBe(0);
    // The CLI prefix replaces ex, but file's IRIs (http://example.org/...)
    // no longer match it, so they fall back to full <...> form.
    expect(result.stdout).not.toMatch(
      /@prefix ex: <http:\/\/example\.org\/>/,
    );
    expect(result.stdout).toContain('<http://example.org/a>');
  });
});
