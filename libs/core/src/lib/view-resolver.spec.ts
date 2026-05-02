import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseSourceSpecs,
  type ParsedViewSource,
} from './source-spec';
import { resolveView } from './view-resolver';

describe('resolveView — glob upstream', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-view-resolver-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs a CONSTRUCT view over a single glob upstream', async () => {
    const a = join(dir, 'a.ttl');
    await writeFile(
      a,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:keep ex:p ex:v1 .',
        'ex:drop ex:p ex:v2 .',
      ].join('\n'),
    );

    const registry = parseSourceSpecs([
      { id: 'raw', glob: a },
      {
        id: 'kept',
        from: ['@raw'],
        query:
          'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s = ex:keep) }',
      },
    ]);
    const view = registry[1] as ParsedViewSource;

    const store = await resolveView({ view, registry });
    const quads = store.getQuads(null, null, null, null);
    expect(quads).toHaveLength(1);
    expect(quads[0].subject.value).toBe('http://example.org/keep');
  });

  it('runs a SELECT-{?s,?p,?o} view over multiple glob upstreams', async () => {
    const a = join(dir, 'a.ttl');
    const b = join(dir, 'b.ttl');
    await writeFile(a, '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .');
    await writeFile(b, '@prefix ex: <http://example.org/> . ex:c ex:p ex:d .');

    const registry = parseSourceSpecs([
      { id: 'r1', glob: a },
      { id: 'r2', glob: b },
      {
        id: 'all',
        from: ['@r1', '@r2'],
        query: 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }',
      },
    ]);
    const view = registry[2] as ParsedViewSource;

    const store = await resolveView({ view, registry });
    const subjects = store
      .getQuads(null, null, null, null)
      .map((q) => q.subject.value)
      .sort();
    expect(subjects).toEqual([
      'http://example.org/a',
      'http://example.org/c',
    ]);
  });

  it('reads queryFile relative to cwd and uses it', async () => {
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
        join(dir, 'view.rq'),
        'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s = ex:keep) }',
      );
      const registry = parseSourceSpecs([
        { id: 'raw', glob: a },
        { id: 'kept', from: ['@raw'], queryFile: 'view.rq' },
      ]);
      const view = registry[1] as ParsedViewSource;

      const store = await resolveView({ view, registry });
      const quads = store.getQuads(null, null, null, null);
      expect(quads).toHaveLength(1);
      expect(quads[0].subject.value).toBe('http://example.org/keep');
    } finally {
      process.chdir(cwd);
    }
  });
});

describe('resolveView — failure surfacing', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-view-resolver-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('throws when a `from:` ref does not exist in the registry', async () => {
    const registry = parseSourceSpecs([
      {
        id: 'v',
        from: ['@nope'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);
    const view = registry[0] as ParsedViewSource;
    await expect(resolveView({ view, registry })).rejects.toThrow(
      /unknown.*@nope/i,
    );
  });

  it('throws when a `from:` ref resolves to an endpoint (not yet supported)', async () => {
    const registry = parseSourceSpecs([
      { id: 'live', endpoint: 'https://example.org/sparql' },
      {
        id: 'v',
        from: ['@live'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);
    const view = registry[1] as ParsedViewSource;
    await expect(resolveView({ view, registry })).rejects.toThrow(
      /endpoint.*upstream.*not yet supported/i,
    );
  });

  it('throws when a `from:` ref resolves to another view (not yet supported)', async () => {
    const a = join(dir, 'a.ttl');
    await writeFile(a, '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .');
    const registry = parseSourceSpecs([
      { id: 'raw', glob: a },
      {
        id: 'inner',
        from: ['@raw'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
      {
        id: 'outer',
        from: ['@inner'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);
    const view = registry[2] as ParsedViewSource;
    await expect(resolveView({ view, registry })).rejects.toThrow(
      /view.*upstream.*not yet supported/i,
    );
  });

  it('detects a self-cycle on the ref DAG', async () => {
    const registry = parseSourceSpecs([
      {
        id: 'loop',
        from: ['@loop'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);
    const view = registry[0] as ParsedViewSource;
    await expect(resolveView({ view, registry })).rejects.toThrow(
      /cycle.*loop/i,
    );
  });

  it('surfaces a syntactically invalid view query as an error before scanning upstream', async () => {
    const a = join(dir, 'a.ttl');
    await writeFile(a, '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .');
    const registry = parseSourceSpecs([
      { id: 'raw', glob: a },
      { id: 'bad', from: ['@raw'], query: 'NOT A QUERY' },
    ]);
    const view = registry[1] as ParsedViewSource;
    await expect(resolveView({ view, registry })).rejects.toThrow();
  });
});
