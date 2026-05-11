import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from 'n3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveSource } from './resolve-source';
import { parseSourceSpec, parseSourceSpecs } from './source-spec';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from '../test/fake-sparql-endpoint';

const SPARQL_JSON_TWO_BINDINGS = JSON.stringify({
  head: { vars: ['s', 'p', 'o'] },
  results: {
    bindings: [
      {
        s: { type: 'uri', value: 'http://example.org/a' },
        p: { type: 'uri', value: 'http://example.org/p' },
        o: { type: 'uri', value: 'http://example.org/b' },
      },
    ],
  },
});

describe('resolveSource — endpoint target', () => {
  let endpoint: FakeSparqlEndpoint | undefined;

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
  });

  it('returns pass-through and never contacts the endpoint', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON_TWO_BINDINGS,
    }));

    const target = parseSourceSpec(endpoint.url);
    const result = await resolveSource(target);

    expect(result.mode).toBe('pass-through');
    if (result.mode !== 'pass-through') throw new Error('unreachable');
    expect(result.endpoint.endpoint).toBe(endpoint.url);
    expect(endpoint.requestCount()).toBe(0);
  });

  it('preserves auth/headers/timeoutMs on object-form endpoint targets', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON_TWO_BINDINGS,
    }));

    const target = parseSourceSpec({
      endpoint: endpoint.url,
      auth: { type: 'bearer', token: 'tk-1' },
      headers: { 'X-Tenant': 'acme' },
      timeoutMs: 1234,
    });
    const result = await resolveSource(target);

    expect(result.mode).toBe('pass-through');
    if (result.mode !== 'pass-through') throw new Error('unreachable');
    expect(result.endpoint.auth).toEqual({ type: 'bearer', token: 'tk-1' });
    expect(result.endpoint.headers).toEqual({ 'X-Tenant': 'acme' });
    expect(result.endpoint.timeoutMs).toBe(1234);
    expect(endpoint.requestCount()).toBe(0);
  });
});

describe('resolveSource — glob target', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-resolve-source-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('materializes a glob target into a Store', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const target = parseSourceSpec(join(dir, '*.ttl'));
    const result = await resolveSource(target);

    expect(result.mode).toBe('materialized');
    if (result.mode !== 'materialized') throw new Error('unreachable');
    expect(result.store.size).toBe(1);
    expect(result.files).toHaveLength(1);
  });

  it('threads the parsed transform pipeline through the glob loader', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    // Stub transform: drop every loaded quad. Confirms the executor is wired in.
    const dropAll = {
      key: 'stubDropAll',
      parse: () => () => new Store(),
    };
    const target = parseSourceSpec(
      { glob: join(dir, '*.ttl'), transforms: [{ stubDropAll: true }] },
      { transformRegistry: [dropAll] },
    );
    const result = await resolveSource(target);

    if (result.mode !== 'materialized') throw new Error('unreachable');
    expect(result.store.size).toBe(0);
    // Files list still reflects what was matched on disk; only the Store content changed.
    expect(result.files).toHaveLength(1);
  });
});

describe('resolveSource — annotateSource transform on glob target', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-resolve-annotate-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function fileQuads(store: Store, predicateIri: string) {
    return store.getQuads(
      null,
      { termType: 'NamedNode', value: predicateIri } as never,
      null,
      null,
    );
  }

  it('emits source records with file:// IRI and per-(p,o) line for a Turtle source', async () => {
    const file = join(dir, 'a.ttl');
    await writeFile(
      file,
      [
        '@prefix ex: <http://example.org/> .',
        '',
        'ex:a ex:p1 ex:b ;',
        '  ex:p2 ex:c .',
        '',
      ].join('\n'),
    );
    const target = parseSourceSpec({
      glob: join(dir, '*.ttl'),
      transforms: [{ annotateSource: {} }],
    });
    const result = await resolveSource(target);
    if (result.mode !== 'materialized') throw new Error('unreachable');

    const fileTriples = fileQuads(result.store, 'urn:sparqly:file');
    expect(fileTriples).toHaveLength(2);
    for (const q of fileTriples) {
      expect(q.object.value).toBe(`file://${file}`);
    }
    const lineTriples = fileQuads(result.store, 'urn:sparqly:line');
    const lineValues = lineTriples
      .map((q) => Number(q.object.value))
      .sort((a, b) => a - b);
    expect(lineValues).toEqual([3, 4]);
  });

  it('emits file-only source records (no line) for JSON-LD sources', async () => {
    const file = join(dir, 'a.jsonld');
    await writeFile(
      file,
      JSON.stringify({
        '@context': { ex: 'http://example.org/' },
        '@id': 'ex:a',
        'ex:p': { '@id': 'ex:b' },
      }),
    );
    const target = parseSourceSpec({
      glob: join(dir, '*.jsonld'),
      transforms: [{ annotateSource: {} }],
    });
    const result = await resolveSource(target);
    if (result.mode !== 'materialized') throw new Error('unreachable');

    const fileTriples = fileQuads(result.store, 'urn:sparqly:file');
    expect(fileTriples).toHaveLength(1);
    expect(fileTriples[0].object.value).toBe(`file://${file}`);
    expect(fileQuads(result.store, 'urn:sparqly:line')).toHaveLength(0);
  });

  it('emits no source records when annotateSource is not listed', async () => {
    const file = join(dir, 'a.ttl');
    await writeFile(
      file,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const target = parseSourceSpec(join(dir, '*.ttl'));
    const result = await resolveSource(target);
    if (result.mode !== 'materialized') throw new Error('unreachable');

    expect(fileQuads(result.store, 'urn:sparqly:source')).toHaveLength(0);
    expect(fileQuads(result.store, 'urn:sparqly:file')).toHaveLength(0);
    expect(fileQuads(result.store, 'urn:sparqly:line')).toHaveLength(0);
  });

  it('emits two records under one quoted-triple subject when the same triple lives in two files (graphName: preserve)', async () => {
    const a = join(dir, 'a.ttl');
    const b = join(dir, 'b.ttl');
    const triple = '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .';
    await writeFile(a, triple);
    await writeFile(b, triple);

    const target = parseSourceSpec({
      glob: join(dir, '*.ttl'),
      transforms: [{ graphName: 'preserve' }, { annotateSource: {} }],
    });
    const result = await resolveSource(target);
    if (result.mode !== 'materialized') throw new Error('unreachable');

    const sourceTriples = fileQuads(result.store, 'urn:sparqly:source');
    expect(sourceTriples).toHaveLength(2);
    // Both source quads share the same quoted-triple subject term.
    expect(sourceTriples[0].subject.equals(sourceTriples[1].subject)).toBe(true);
    // The blank-node records differ.
    expect(sourceTriples[0].object.equals(sourceTriples[1].object)).toBe(false);

    // Each record points to its own file.
    const fileIris = fileQuads(result.store, 'urn:sparqly:file')
      .map((q) => q.object.value)
      .sort();
    expect(fileIris).toEqual([`file://${a}`, `file://${b}`]);
  });

  it('honours custom predicate IRI overrides end-to-end', async () => {
    const file = join(dir, 'a.ttl');
    await writeFile(
      file,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const target = parseSourceSpec({
      glob: join(dir, '*.ttl'),
      transforms: [
        {
          annotateSource: {
            source: 'http://my/source',
            file: 'http://my/file',
            line: 'http://my/line',
          },
        },
      ],
    });
    const result = await resolveSource(target);
    if (result.mode !== 'materialized') throw new Error('unreachable');

    expect(fileQuads(result.store, 'http://my/source')).toHaveLength(1);
    expect(fileQuads(result.store, 'http://my/file')).toHaveLength(1);
    expect(fileQuads(result.store, 'http://my/line')).toHaveLength(1);
    // Defaults are not emitted when overridden.
    expect(fileQuads(result.store, 'urn:sparqly:source')).toHaveLength(0);
    expect(fileQuads(result.store, 'urn:sparqly:file')).toHaveLength(0);
    expect(fileQuads(result.store, 'urn:sparqly:line')).toHaveLength(0);
  });
});

describe('resolveSource — empty target', () => {
  it('materializes an empty target into a fresh empty Store', async () => {
    const target = parseSourceSpec({ id: 'host', empty: true });
    const result = await resolveSource(target);

    expect(result.mode).toBe('materialized');
    if (result.mode !== 'materialized') throw new Error('unreachable');
    expect(result.store.size).toBe(0);
    expect(result.files).toEqual([]);
  });
});

describe('resolveSource — view target', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-resolve-source-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('walks the from: chain and materializes the view query result', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      [
        '@prefix ex: <http://example.org/> .',
        'ex:a ex:p ex:b .',
        'ex:c ex:p ex:d .',
      ].join('\n'),
    );

    const registry = parseSourceSpecs([
      { id: 'raw', glob: join(dir, '*.ttl') },
      {
        id: 'derived',
        from: '@raw',
        query:
          'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ex:r ?o } WHERE { ?s ex:p ?o }',
      },
    ]);
    const target = registry.find((s) => s.id === 'derived');
    if (!target) throw new Error('derived view missing from registry');

    const result = await resolveSource(target, { registry });

    expect(result.mode).toBe('materialized');
    if (result.mode !== 'materialized') throw new Error('unreachable');
    const predicates = new Set(
      result.store.getQuads(null, null, null, null).map((q) => q.predicate.value),
    );
    expect(predicates.has('http://example.org/r')).toBe(true);
  });

  it('does not open or fetch sibling registry entries unrelated to the target', async () => {
    let siblingHits = 0;
    const sibling = await startFakeSparqlEndpoint(() => {
      siblingHits++;
      return {
        contentType: 'application/sparql-results+json',
        body: SPARQL_JSON_TWO_BINDINGS,
      };
    });
    try {
      await writeFile(
        join(dir, 'a.ttl'),
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
      );

      const registry = parseSourceSpecs([
        { id: 'prod-A', endpoint: sibling.url },
        { id: 'raw', glob: join(dir, '*.ttl') },
        {
          id: 'stats',
          from: '@raw',
          query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        },
      ]);
      const target = registry.find((s) => s.id === 'stats');
      if (!target) throw new Error('stats view missing from registry');

      const result = await resolveSource(target, { registry });

      expect(result.mode).toBe('materialized');
      expect(siblingHits).toBe(0);
    } finally {
      await sibling.close();
    }
  });
});
