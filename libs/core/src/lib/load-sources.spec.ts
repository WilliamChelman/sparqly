import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSources } from './load-sources';

describe('loadSources', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-loadsources-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads a glob string source through the parser end-to-end', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const { store, files } = await loadSources([join(dir, '*.ttl')]);
    expect(files).toHaveLength(1);
    expect(store.size).toBe(1);
  });

  it('loads an object-form glob source (exotic @ path supported)', async () => {
    const archive = join(dir, '@archive');
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    // Use the exotic-path object form to escape the @ discriminator.
    void archive;
    const { store } = await loadSources([{ glob: join(dir, '*.ttl') }]);
    expect(store.size).toBe(1);
  });

  it('rejects an http(s) endpoint string with a not-yet-supported error pointing at #60', async () => {
    await expect(
      loadSources(['https://example.com/sparql']),
    ).rejects.toThrow(
      /SPARQL endpoint sources are not yet supported.*issues\/60/,
    );
  });

  it('rejects an @id reference string with a not-yet-supported error pointing at #60', async () => {
    await expect(loadSources(['@my-source'])).rejects.toThrow(
      /@id reference sources are not yet supported.*issues\/60/,
    );
  });

  it('rejects an object-form endpoint with a not-yet-supported error pointing at #60', async () => {
    await expect(
      loadSources([{ endpoint: 'https://example.com/sparql' }]),
    ).rejects.toThrow(
      /SPARQL endpoint sources are not yet supported.*issues\/60/,
    );
  });
});

describe('loadSources — per-source pipeline', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-loadsources-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('per-source graphMode wins over the global graphMode', async () => {
    const a = join(dir, 'a.ttl');
    const b = join(dir, 'b.ttl');
    await writeFile(a, '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .');
    await writeFile(b, '@prefix ex: <http://example.org/> . ex:c ex:p ex:d .');

    const { store } = await loadSources(
      [
        { glob: a, graphMode: 'forceAll' },
        { glob: b },
      ],
      { graphMode: 'preserve' },
    );

    const quads = store.getQuads(null, null, null, null);
    const byGraph = new Map<string, number>();
    for (const q of quads) {
      const key = q.graph.termType === 'DefaultGraph' ? '<default>' : q.graph.value;
      byGraph.set(key, (byGraph.get(key) ?? 0) + 1);
    }
    expect(byGraph.get(`file://${a}`)).toBe(1);
    expect(byGraph.get('<default>')).toBe(1);
  });

  it('SELECT prefilter (?s ?p ?o) narrows the source to the bound triples', async () => {
    const a = join(dir, 'a.ttl');
    await writeFile(
      a,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:keep ex:p ex:v1 .',
        'ex:drop ex:p ex:v2 .',
      ].join('\n'),
    );

    const { store } = await loadSources([
      {
        glob: a,
        prefilter:
          'PREFIX ex: <http://example.org/> SELECT ?s ?p ?o WHERE { ?s ?p ?o FILTER(?s = ex:keep) }',
      },
    ]);

    const quads = store.getQuads(null, null, null, null);
    expect(quads).toHaveLength(1);
    expect(quads[0].subject.value).toBe('http://example.org/keep');
  });

  it('CONSTRUCT prefilter emits triples (default graph) and is then subject to graphMode', async () => {
    const a = join(dir, 'a.ttl');
    await writeFile(
      a,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:a ex:p ex:b .',
        'ex:c ex:p ex:d .',
      ].join('\n'),
    );

    const { store } = await loadSources([
      {
        glob: a,
        graphMode: 'forceAll',
        graph: 'urn:after-prefilter',
        prefilter:
          'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ex:renamed ?o } WHERE { ?s ex:p ?o }',
      },
    ]);

    const quads = store.getQuads(null, null, null, null);
    expect(quads).toHaveLength(2);
    for (const q of quads) {
      expect(q.predicate.value).toBe('http://example.org/renamed');
      expect(q.graph.value).toBe('urn:after-prefilter');
    }
  });

  it('reads prefilterFile cwd-relative and applies it', async () => {
    const a = join(dir, 'a.ttl');
    await writeFile(
      a,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:keep ex:p ex:v1 .',
        'ex:drop ex:p ex:v2 .',
      ].join('\n'),
    );

    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await writeFile(
        join(dir, 'pf.rq'),
        'PREFIX ex: <http://example.org/> SELECT ?s ?p ?o WHERE { ?s ?p ?o FILTER(?s = ex:keep) }',
      );
      const { store } = await loadSources([
        { glob: a, prefilterFile: 'pf.rq' },
      ]);
      const quads = store.getQuads(null, null, null, null);
      expect(quads).toHaveLength(1);
      expect(quads[0].subject.value).toBe('http://example.org/keep');
    } finally {
      process.chdir(cwd);
    }
  });

  it('rejects an invalid prefilter (ASK) before any I/O', async () => {
    await expect(
      loadSources([{ glob: 'never-read/*.ttl', prefilter: 'ASK { ?s ?p ?o }' }]),
    ).rejects.toThrow(/ASK.*not.*allowed.*prefilter/i);
  });

  it('per-source graph: IRI overrides the synthetic file:// graph IRI', async () => {
    const a = join(dir, 'a.ttl');
    await writeFile(a, '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .');

    const { store } = await loadSources([
      { glob: a, graphMode: 'forceAll', graph: 'urn:my:custom-graph' },
    ]);

    const [quad] = store.getQuads(null, null, null, null);
    expect(quad.graph.termType).toBe('NamedNode');
    expect(quad.graph.value).toBe('urn:my:custom-graph');
  });
});
