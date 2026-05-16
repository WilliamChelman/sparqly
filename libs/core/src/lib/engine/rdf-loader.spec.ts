import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRdf, loadRdfResult } from './rdf-loader';
import { QueryEngine } from './query-engine';
import { recordingLogger } from '../test/recording-logger';

const FIXTURES_DIR = resolve(__dirname, '../../../../../test/data/formats');

describe('loadRdf', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-loader-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads matching Turtle files into an N3.Store', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    await writeFile(
      join(dir, 'b.ttl'),
      '@prefix ex: <http://example.org/> . ex:c ex:p ex:d .',
    );

    const { store, files } = await loadRdf({ sources: join(dir, '*.ttl') });

    expect(files).toHaveLength(2);
    expect(store.size).toBe(2);
  });

  it('returns an empty store when the glob matches no files (ADR-0028)', async () => {
    const { store, files } = await loadRdf({
      sources: join(dir, 'nope-*.ttl'),
    });
    expect(files).toEqual([]);
    expect(store.size).toBe(0);
  });

  it('throws a parse error mentioning the offending file', async () => {
    const bad = join(dir, 'broken.ttl');
    await writeFile(bad, 'this is not valid turtle <<<');

    await expect(loadRdf({ sources: join(dir, '*.ttl') })).rejects.toThrow(
      /broken\.ttl/,
    );
  });

  it('loads N-Triples files', async () => {
    await writeFile(
      join(dir, 'a.nt'),
      '<http://example.org/a> <http://example.org/p> <http://example.org/b> .\n',
    );
    const { store } = await loadRdf({ sources: join(dir, '*.nt') });
    expect(store.size).toBe(1);
  });

  it('loads N-Quads files including the named graph', async () => {
    await writeFile(
      join(dir, 'a.nq'),
      '<http://example.org/a> <http://example.org/p> <http://example.org/b> <http://example.org/g> .\n',
    );
    const { store } = await loadRdf({ sources: join(dir, '*.nq') });
    expect(store.size).toBe(1);
    const [quad] = store.getQuads(null, null, null, null);
    expect(quad.graph.value).toBe('http://example.org/g');
  });

  it('loads TriG files with named graph blocks', async () => {
    await writeFile(
      join(dir, 'a.trig'),
      '@prefix ex: <http://example.org/> .\nex:g { ex:a ex:p ex:b . }\n',
    );
    const { store } = await loadRdf({ sources: join(dir, '*.trig') });
    expect(store.size).toBe(1);
    const [quad] = store.getQuads(null, null, null, null);
    expect(quad.graph.value).toBe('http://example.org/g');
  });

  it('loads JSON-LD files', async () => {
    await writeFile(
      join(dir, 'a.jsonld'),
      JSON.stringify({
        '@context': { ex: 'http://example.org/' },
        '@id': 'ex:a',
        'ex:p': { '@id': 'ex:b' },
      }),
    );
    const { store } = await loadRdf({ sources: join(dir, '*.jsonld') });
    expect(store.size).toBe(1);
  });

  it('loads RDF/XML files', async () => {
    await writeFile(
      join(dir, 'a.rdf'),
      dedent`
        <?xml version="1.0"?>
        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:ex="http://example.org/">
          <rdf:Description rdf:about="http://example.org/a">
            <ex:p rdf:resource="http://example.org/b"/>
          </rdf:Description>
        </rdf:RDF>
      ` + '\n',
    );
    const { store } = await loadRdf({ sources: join(dir, '*.rdf') });
    expect(store.size).toBe(1);
  });

  it('loads a mixed-format glob into a single store', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    await writeFile(
      join(dir, 'b.nt'),
      '<http://example.org/c> <http://example.org/p> <http://example.org/d> .\n',
    );
    await writeFile(
      join(dir, 'c.jsonld'),
      JSON.stringify({
        '@context': { ex: 'http://example.org/' },
        '@id': 'ex:e',
        'ex:p': { '@id': 'ex:f' },
      }),
    );
    await writeFile(
      join(dir, 'd.rdf'),
      dedent`
        <?xml version="1.0"?>
        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:ex="http://example.org/">
          <rdf:Description rdf:about="http://example.org/g">
            <ex:p rdf:resource="http://example.org/h"/>
          </rdf:Description>
        </rdf:RDF>
      ` + '\n',
    );

    const { store, files } = await loadRdf({ sources: join(dir, '*') });
    expect(files).toHaveLength(4);
    expect(store.size).toBe(4);
  });

  it('reports the offending file path on parse error for non-Turtle formats', async () => {
    await writeFile(join(dir, 'bad.jsonld'), '{ this is not valid json');
    await expect(loadRdf({ sources: join(dir, '*.jsonld') })).rejects.toThrow(
      /bad\.jsonld/,
    );
  });

  it('loads the committed multi-format fixtures via a single glob', async () => {
    const { store, files } = await loadRdf({
      sources: join(FIXTURES_DIR, 'sample.*'),
    });
    expect(files).toHaveLength(6);
    expect(store.size).toBe(6);
  });

  it('places triple-format quads in the default graph by default', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const { store } = await loadRdf({ sources: join(dir, '*.ttl') });
    const [quad] = store.getQuads(null, null, null, null);
    expect(quad.graph.termType).toBe('DefaultGraph');
  });

  it('preserves declared graph IRIs from quad-format files by default', async () => {
    await writeFile(
      join(dir, 'a.nq'),
      '<http://example.org/a> <http://example.org/p> <http://example.org/b> <http://example.org/g> .\n',
    );
    const { store } = await loadRdf({ sources: join(dir, '*.nq') });
    const [quad] = store.getQuads(null, null, null, null);
    expect(quad.graph.value).toBe('http://example.org/g');
  });

  it('SPARQL GRAPH ?g binds quad-format graphs by default and triple-format files yield no GRAPH bindings', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    await writeFile(
      join(dir, 'b.nq'),
      '<http://example.org/c> <http://example.org/p> <http://example.org/d> <http://example.org/g> .\n',
    );
    const { store } = await loadRdf({ sources: join(dir, '*') });
    const engine = new QueryEngine(store);
    const result = await engine.execute(
      'SELECT ?g WHERE { GRAPH ?g { ?s ?p ?o } }',
    );
    const parsed = JSON.parse(result.body);
    const graphs = parsed.results.bindings.map(
      (b: { g: { value: string } }) => b.g.value,
    );
    expect(graphs).toEqual(['http://example.org/g']);
  });

  it('captures per-file prefixes declared in turtle source', async () => {
    const file = join(dir, 'a.ttl');
    await writeFile(
      file,
      dedent`
        @prefix ex: <http://example.org/> .
        @prefix dct: <http://purl.org/dc/terms/> .
        ex:a ex:p ex:b .
      `,
    );
    const result = await loadRdf({ sources: join(dir, '*.ttl') });
    expect(result.prefixes[file]).toEqual({
      ex: 'http://example.org/',
      dct: 'http://purl.org/dc/terms/',
    });
  });

  it('captures per-file prefixes from trig source', async () => {
    const file = join(dir, 'a.trig');
    await writeFile(
      file,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:g { ex:a ex:p ex:b . }
      `,
    );
    const result = await loadRdf({ sources: join(dir, '*.trig') });
    expect(result.prefixes[file]).toEqual({
      ex: 'http://example.org/',
    });
  });

  it('exposes raw per-file records on the load result', async () => {
    const a = join(dir, 'a.ttl');
    await writeFile(a, '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .');

    const { perFileRecords } = await loadRdf({ sources: join(dir, '*.ttl') });
    const records = perFileRecords.get(a);
    expect(records).toBeDefined();
    expect(records).toHaveLength(1);
    expect(records?.[0].quad.subject.value).toBe('http://example.org/a');
  });
});

describe('loadRdfResult', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-loader-result-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns Result.ok with files + store when the glob matches', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const result = await loadRdfResult({ sources: join(dir, '*.ttl') });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.files).toHaveLength(1);
    expect(result.value.store.size).toBe(1);
  });

  it('returns Result.ok with an empty store when the glob matches no files', async () => {
    const pattern = join(dir, 'nope-*.ttl');
    const result = await loadRdfResult({ sources: pattern });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.files).toEqual([]);
    expect(result.value.store.size).toBe(0);
    expect(result.value.prefixes).toEqual({});
    expect(result.value.perFileRecords?.size).toBe(0);
  });

  it('emits a single warn line naming the glob and absolute base path on empty match', async () => {
    const pattern = join(dir, 'nope-*.ttl');
    const { logger, entries } = recordingLogger();

    const result = await loadRdfResult({ sources: pattern, logger });

    expect(result.isOk()).toBe(true);
    const warnings = entries.filter((e) => e.level === 'warn');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].msg).toContain(pattern);
    expect(warnings[0].msg).toContain(dir);
    expect(warnings[0].fields).toEqual({ glob: [pattern], base: [dir] });
  });

  it('returns Result.err with a glob-load variant naming the offending file on parse failure', async () => {
    const bad = join(dir, 'broken.ttl');
    await writeFile(bad, 'this is not valid turtle <<<');
    const pattern = join(dir, '*.ttl');

    const result = await loadRdfResult({ sources: pattern });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('glob-load');
    if (result.error.kind !== 'glob-load') throw new Error('unreachable');
    expect(result.error.glob).toEqual([pattern]);
    expect(result.error.file).toBe(bad);
  });

  it('uses contentReader override bytes instead of disk content when provided (ADR-0029)', async () => {
    const path = join(dir, 'foaf.ttl');
    // Disk file says one thing; override returns different content.
    await writeFile(
      path,
      '@prefix ex: <http://example.org/> . ex:disk ex:p ex:disk .',
    );
    const overrideBytes = Buffer.from(
      '@prefix ex: <http://example.org/> . ex:override ex:p ex:override .',
      'utf8',
    );

    const result = await loadRdfResult({
      sources: path,
      contentReader: async (absPath) =>
        absPath === path ? overrideBytes : null,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    const subjects = [...result.value.store].map((q) => q.subject.value);
    expect(subjects).toEqual(['http://example.org/override']);
  });

  it('falls back to disk when contentReader returns null for a path', async () => {
    const path = join(dir, 'foaf.ttl');
    await writeFile(
      path,
      '@prefix ex: <http://example.org/> . ex:disk ex:p ex:disk .',
    );

    const result = await loadRdfResult({
      sources: path,
      contentReader: async () => null,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    const subjects = [...result.value.store].map((q) => q.subject.value);
    expect(subjects).toEqual(['http://example.org/disk']);
  });

  it('surfaces a rejected contentReader as a typed glob-load error rather than an unhandled rejection (ADR-0029)', async () => {
    // Regression: ad-hoc pinning of split-glob parents enumerates the working
    // tree and feeds each match to the contentReader, which throws
    // PinnedFileMissingError when a working-tree file is absent at the pinned
    // SHA. The rejection must be caught and surfaced as a structured
    // `glob-load` error so the caller can promote it to a `git-pin` error;
    // otherwise it escapes the Result chain and the server returns 500.
    const path = join(dir, 'foaf.ttl');
    await writeFile(
      path,
      '@prefix ex: <http://example.org/> . ex:disk ex:p ex:disk .',
    );

    const result = await loadRdfResult({
      sources: path,
      contentReader: async () => {
        throw new Error('pinned source: file foaf.ttl is absent from the git tree at v3.2.0');
      },
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('glob-load');
    if (result.error.kind !== 'glob-load') throw new Error('unreachable');
    expect(result.error.file).toBe(path);
    expect(result.error.message).toContain('pinned source: file foaf.ttl');
  });

  it('accepts an array glob and warns once naming both patterns when empty', async () => {
    const patterns = [join(dir, 'nope-a*.ttl'), join(dir, 'nope-b*.ttl')];
    const { logger, entries } = recordingLogger();

    const result = await loadRdfResult({ sources: patterns, logger });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.files).toEqual([]);
    const warnings = entries.filter((e) => e.level === 'warn');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].fields?.glob).toEqual(patterns);
  });
});
