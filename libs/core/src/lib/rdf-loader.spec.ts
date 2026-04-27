import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRdf } from './rdf-loader';

const FIXTURES_DIR = resolve(__dirname, '../../../../test/data/formats');

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

  it('throws when the glob matches no files', async () => {
    await expect(
      loadRdf({ sources: join(dir, 'nope-*.ttl') }),
    ).rejects.toThrow(/no files/i);
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
      `<?xml version="1.0"?>\n<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:ex="http://example.org/">\n  <rdf:Description rdf:about="http://example.org/a">\n    <ex:p rdf:resource="http://example.org/b"/>\n  </rdf:Description>\n</rdf:RDF>\n`,
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
      `<?xml version="1.0"?>\n<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:ex="http://example.org/">\n  <rdf:Description rdf:about="http://example.org/g">\n    <ex:p rdf:resource="http://example.org/h"/>\n  </rdf:Description>\n</rdf:RDF>\n`,
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
});
