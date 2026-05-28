import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { Parser } from 'n3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

describe('sparqly query — TriG and N-Quads output formats (#382)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-query-rdf-fmt-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeSource(): Promise<string> {
    const src = join(dir, 'data.ttl');
    await writeFile(
      src,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:alice ex:name "Alice" .
        ex:bob ex:name "Bob" .
      ` + '\n',
    );
    return src;
  }

  function expectAliceAndBob(quads: ReturnType<Parser['parse']>): void {
    const subjects = new Set(quads.map((q) => q.subject.value));
    expect(subjects).toContain('http://example.org/alice');
    expect(subjects).toContain('http://example.org/bob');
  }

  it('--format trig serialises CONSTRUCT results as TriG (parseable round-trip)', async () => {
    const src = await writeSource();
    const out = join(dir, 'out.trig');

    const result = await runCli([
      'query',
      src,
      '--format',
      'trig',
      '-q',
      'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      '-o',
      out,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);

    const body = await readFile(out, 'utf8');
    const quads = new Parser({ format: 'TriG' }).parse(body);
    expect(quads).toHaveLength(2);
    expectAliceAndBob(quads);
  });

  it('--format nquads serialises CONSTRUCT results as N-Quads (parseable round-trip)', async () => {
    const src = await writeSource();
    const out = join(dir, 'out.nq');

    const result = await runCli([
      'query',
      src,
      '--format',
      'nquads',
      '-q',
      'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      '-o',
      out,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);

    const body = await readFile(out, 'utf8');
    const quads = new Parser({ format: 'N-Quads' }).parse(body);
    expect(quads).toHaveLength(2);
    expectAliceAndBob(quads);
  });

  it('--out result.trig (no --format) infers TriG', async () => {
    const src = await writeSource();
    const out = join(dir, 'inferred.trig');

    const result = await runCli([
      'query',
      src,
      '-q',
      'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      '-o',
      out,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);

    const body = await readFile(out, 'utf8');
    const quads = new Parser({ format: 'TriG' }).parse(body);
    expect(quads).toHaveLength(2);
  });

  it('--out result.nq (no --format) infers N-Quads', async () => {
    const src = await writeSource();
    const out = join(dir, 'inferred.nq');

    const result = await runCli([
      'query',
      src,
      '-q',
      'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      '-o',
      out,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);

    const body = await readFile(out, 'utf8');
    const quads = new Parser({ format: 'N-Quads' }).parse(body);
    expect(quads).toHaveLength(2);
  });

  it('--out result.nquads (no --format) infers N-Quads', async () => {
    const src = await writeSource();
    const out = join(dir, 'inferred.nquads');

    const result = await runCli([
      'query',
      src,
      '-q',
      'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      '-o',
      out,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);

    const body = await readFile(out, 'utf8');
    const quads = new Parser({ format: 'N-Quads' }).parse(body);
    expect(quads).toHaveLength(2);
  });

  it('--format trig on a non-triple-shaped SELECT exits non-zero naming the projection', async () => {
    const src = await writeSource();

    const result = await runCli([
      'query',
      src,
      '--format',
      'trig',
      '-q',
      'SELECT ?subj WHERE { ?subj ?p ?o }',
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/triple-shaped|\?subj/);
  });

  it('--format nquads on an ASK exits non-zero with a clear error', async () => {
    const src = await writeSource();

    const result = await runCli([
      'query',
      src,
      '--format',
      'nquads',
      '-q',
      'ASK WHERE { ?s ?p ?o }',
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/nquads|n-quads|incompatible|ASK/i);
  });
});

describe('sparqly query — triple-shaped SELECT reification (#383)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-query-spo-reify-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeTrigSource(): Promise<string> {
    const src = join(dir, 'data.trig');
    await writeFile(
      src,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:g {
          ex:alice ex:name "Alice" .
          ex:bob ex:name "Bob" .
        }
      ` + '\n',
    );
    return src;
  }

  it('SELECT ?s ?p ?o ?g → --format trig round-trips through the n3 parser', async () => {
    const src = await writeTrigSource();
    const out = join(dir, 'reified.trig');

    const result = await runCli([
      'query',
      src,
      '--format',
      'trig',
      '-q',
      'SELECT ?s ?p ?o ?g WHERE { GRAPH ?g { ?s ?p ?o } }',
      '-o',
      out,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);

    const body = await readFile(out, 'utf8');
    const quads = new Parser({ format: 'TriG' }).parse(body);
    expect(quads).toHaveLength(2);
    const graphs = new Set(quads.map((q) => q.graph.value));
    expect(graphs).toEqual(new Set(['http://example.org/g']));
  });

  it('SELECT ?s ?p ?o ?g → --format nquads round-trips through the n3 parser', async () => {
    const src = await writeTrigSource();
    const out = join(dir, 'reified.nq');

    const result = await runCli([
      'query',
      src,
      '--format',
      'nquads',
      '-q',
      'SELECT ?s ?p ?o ?g WHERE { GRAPH ?g { ?s ?p ?o } }',
      '-o',
      out,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);

    const body = await readFile(out, 'utf8');
    const quads = new Parser({ format: 'N-Quads' }).parse(body);
    expect(quads).toHaveLength(2);
    const subjects = new Set(quads.map((q) => q.subject.value));
    expect(subjects).toContain('http://example.org/alice');
    expect(subjects).toContain('http://example.org/bob');
  });

  it('SELECT ?s ?p ?o → --format turtle produces valid Turtle for the default graph', async () => {
    const src = join(dir, 'data.ttl');
    await writeFile(
      src,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:alice ex:name "Alice" .
      ` + '\n',
    );
    const out = join(dir, 'reified.ttl');

    const result = await runCli([
      'query',
      src,
      '--format',
      'turtle',
      '-q',
      'SELECT ?s ?p ?o WHERE { ?s ?p ?o }',
      '-o',
      out,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);

    const body = await readFile(out, 'utf8');
    const quads = new Parser({ format: 'text/turtle' }).parse(body);
    expect(quads).toHaveLength(1);
    expect(quads[0].subject.value).toBe('http://example.org/alice');
  });

  it('SELECT ?s ?p ?o ?g where ?g is unbound puts rows in the default graph (ADR-0049)', async () => {
    const src = join(dir, 'plain.ttl');
    await writeFile(
      src,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:carol ex:name "Carol" .
        ex:dan ex:name "Dan" .
      ` + '\n',
    );
    const out = join(dir, 'unbound-g.trig');

    // The TTL source has no named graphs, so every binding in this 4-var SELECT
    // leaves ?g unbound. Without ADR-0049's "promote to default graph" rule these
    // rows would be dropped by the reifier; we assert they survive.
    const result = await runCli([
      'query',
      src,
      '--format',
      'trig',
      '-q',
      'SELECT ?s ?p ?o ?g WHERE { ?s ?p ?o }',
      '-o',
      out,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);

    const body = await readFile(out, 'utf8');
    const quads = new Parser({ format: 'TriG' }).parse(body);
    expect(quads).toHaveLength(2);
    for (const q of quads) {
      expect(q.graph.termType).toBe('DefaultGraph');
    }
  });
});
