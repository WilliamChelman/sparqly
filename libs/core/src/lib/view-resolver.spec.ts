import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseSourceSpecs,
  type ParsedViewSource,
} from './source-spec';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './test/fake-sparql-endpoint';
import { resolveView } from './view-resolver';

const SPARQL_JSON_TWO_BINDINGS = JSON.stringify({
  head: { vars: ['s', 'p', 'o'] },
  results: {
    bindings: [
      {
        s: { type: 'uri', value: 'http://example.org/keep' },
        p: { type: 'uri', value: 'http://example.org/p' },
        o: { type: 'uri', value: 'http://example.org/v1' },
      },
      {
        s: { type: 'uri', value: 'http://example.org/drop' },
        p: { type: 'uri', value: 'http://example.org/p' },
        o: { type: 'uri', value: 'http://example.org/v2' },
      },
    ],
  },
});

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

describe('resolveView — endpoint upstream', () => {
  let endpoint: FakeSparqlEndpoint | undefined;

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
  });

  it('loads an endpoint upstream in-process and runs the view query over it', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      body: SPARQL_JSON_TWO_BINDINGS,
    }));
    const registry = parseSourceSpecs([
      { id: 'live', endpoint: endpoint.url },
      {
        id: 'kept',
        from: ['@live'],
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

  it('runs a view query over a mixed glob+endpoint upstream', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      body: JSON.stringify({
        head: { vars: ['s', 'p', 'o'] },
        results: {
          bindings: [
            {
              s: { type: 'uri', value: 'http://example.org/from-endpoint' },
              p: { type: 'uri', value: 'http://example.org/p' },
              o: { type: 'uri', value: 'http://example.org/x' },
            },
          ],
        },
      }),
    }));
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-view-resolver-mixed-'));
    try {
      const a = join(dir, 'a.ttl');
      await writeFile(
        a,
        '@prefix ex: <http://example.org/> . ex:from-glob ex:p ex:y .',
      );
      const registry = parseSourceSpecs([
        { id: 'files', glob: a },
        { id: 'live', endpoint: endpoint.url },
        {
          id: 'merged',
          from: ['@files', '@live'],
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
        'http://example.org/from-endpoint',
        'http://example.org/from-glob',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveView — view-on-view composition', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-view-resolver-vov-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves a view whose `from:` references another view, bottom-up', async () => {
    const a = join(dir, 'a.ttl');
    await writeFile(
      a,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:keep ex:p ex:v1 .',
        'ex:drop ex:p ex:v2 .',
        'ex:other ex:p ex:v3 .',
      ].join('\n'),
    );
    const registry = parseSourceSpecs([
      { id: 'raw', glob: a },
      {
        id: 'no-other',
        from: ['@raw'],
        query:
          'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s != ex:other) }',
      },
      {
        id: 'kept',
        from: ['@no-other'],
        query:
          'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s = ex:keep) }',
      },
    ]);
    const view = registry[2] as ParsedViewSource;

    const store = await resolveView({ view, registry });
    const quads = store.getQuads(null, null, null, null);
    expect(quads).toHaveLength(1);
    expect(quads[0].subject.value).toBe('http://example.org/keep');
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

  it('detects a cycle across a two-deep view chain (A -> B -> A)', async () => {
    const registry = parseSourceSpecs([
      {
        id: 'a',
        from: ['@b'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
      {
        id: 'b',
        from: ['@a'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);
    const view = registry[0] as ParsedViewSource;
    await expect(resolveView({ view, registry })).rejects.toThrow(/cycle/i);
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

describe('resolveView — view-cache integration', () => {
  let dataDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'sparqly-view-cache-data-'));
    cacheDir = await mkdtemp(join(tmpdir(), 'sparqly-view-cache-out-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('without a cache block, writes nothing into cacheDir', async () => {
    const a = join(dataDir, 'a.ttl');
    await writeFile(
      a,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const registry = parseSourceSpecs([
      { id: 'raw', glob: a },
      {
        id: 'plain',
        from: ['@raw'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);
    const view = registry[1] as ParsedViewSource;

    await resolveView({ view, registry, cacheDir });
    const entries = await readdir(cacheDir);
    expect(entries).toEqual([]);
  });

  it('on cache miss, runs the view and stores; on hit, returns cached data without re-evaluating upstream', async () => {
    const a = join(dataDir, 'a.ttl');
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
        id: 'cached',
        from: ['@raw'],
        query:
          'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s = ex:keep) }',
        cache: { ttl: '1h' },
      },
    ]);
    const view = registry[1] as ParsedViewSource;

    const first = await resolveView({ view, registry, cacheDir });
    expect(
      first.getQuads(null, null, null, null).map((q) => q.subject.value),
    ).toEqual(['http://example.org/keep']);

    // Replace upstream with completely different data; if the cache is hit,
    // we should still see the original snapshot.
    await writeFile(
      a,
      '@prefix ex: <http://example.org/> . ex:totally ex:different ex:now .',
    );

    const second = await resolveView({ view, registry, cacheDir });
    expect(
      second.getQuads(null, null, null, null).map((q) => q.subject.value),
    ).toEqual(['http://example.org/keep']);
  });

  it('with a freshness ASK that still passes, returns the cached snapshot; when the ASK fails, re-evaluates upstream', async () => {
    const a = join(dataDir, 'a.ttl');
    await writeFile(
      a,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:dataset ex:revision "v1" .',
        'ex:keep ex:p ex:v1 .',
      ].join('\n'),
    );
    const registry = parseSourceSpecs([
      { id: 'raw', glob: a },
      {
        id: 'cached',
        from: ['@raw'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: {
          freshness:
            'PREFIX ex: <http://example.org/> ASK { ex:dataset ex:revision "v1" }',
        },
      },
    ]);
    const view = registry[1] as ParsedViewSource;

    // First call: cache miss → runs view, populates cache.
    const first = await resolveView({ view, registry, cacheDir });
    expect(first.getQuads(null, null, null, null)).toHaveLength(2);

    // Replace upstream content but keep the freshness marker (revision "v1").
    await writeFile(
      a,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:dataset ex:revision "v1" .',
        'ex:keep ex:p ex:v1 .',
        'ex:other ex:p ex:v2 .',
      ].join('\n'),
    );
    // ASK still passes → return cached snapshot (still 2 quads, not 3).
    const second = await resolveView({ view, registry, cacheDir });
    expect(second.getQuads(null, null, null, null)).toHaveLength(2);

    // Bump the freshness marker → ASK now fails, resolver should re-evaluate.
    await writeFile(
      a,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:dataset ex:revision "v2" .',
        'ex:keep ex:p ex:v1 .',
        'ex:other ex:p ex:v2 .',
      ].join('\n'),
    );
    const third = await resolveView({ view, registry, cacheDir });
    expect(third.getQuads(null, null, null, null)).toHaveLength(3);
  });

  it('with everlasting cache, never re-evaluates upstream until invalidate-by-clear', async () => {
    const a = join(dataDir, 'a.ttl');
    await writeFile(
      a,
      '@prefix ex: <http://example.org/> . ex:one ex:p ex:v .',
    );
    const registry = parseSourceSpecs([
      { id: 'raw', glob: a },
      {
        id: 'cached',
        from: ['@raw'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { everlasting: true },
      },
    ]);
    const view = registry[1] as ParsedViewSource;

    let nowMs = 1_000_000;
    const opts = { view, registry, cacheDir, now: () => nowMs };
    const first = await resolveView(opts);
    expect(first.getQuads(null, null, null, null)).toHaveLength(1);

    // Replace upstream and jump far into the future — cache must still win.
    await writeFile(
      a,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:one ex:p ex:v .',
        'ex:two ex:p ex:v .',
      ].join('\n'),
    );
    nowMs += 365 * 24 * 60 * 60 * 1000; // one year later
    const second = await resolveView(opts);
    expect(second.getQuads(null, null, null, null)).toHaveLength(1);
  });

  it('two-deep cached chain: clearing the ancestor cache forces re-evaluation through the chain', async () => {
    const a = join(dataDir, 'a.ttl');
    await writeFile(
      a,
      '@prefix ex: <http://example.org/> . ex:one ex:p ex:v .',
    );
    const registry = parseSourceSpecs([
      { id: 'raw', glob: a },
      {
        id: 'mid',
        from: ['@raw'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
      {
        id: 'leaf',
        from: ['@mid'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
    ]);
    const leaf = registry[2] as ParsedViewSource;

    const first = await resolveView({ view: leaf, registry, cacheDir });
    expect(first.getQuads(null, null, null, null)).toHaveLength(1);

    // Replace the underlying glob data — the leaf cache alone would still be
    // 'fresh' per its TTL, but the `mid` cache is what feeds it.
    await writeFile(
      a,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:one ex:p ex:v .',
        'ex:two ex:p ex:v .',
      ].join('\n'),
    );

    // Confirm that, by itself, the leaf cache stays warm — only ancestor
    // invalidation should bust it.
    const stillCached = await resolveView({ view: leaf, registry, cacheDir });
    expect(stillCached.getQuads(null, null, null, null)).toHaveLength(1);

    // Manually invalidate the mid (ancestor) cache: this is what `cache clear
    // <mid>` will do in #89.
    const mid = registry[1] as ParsedViewSource;
    const { invalidate } = await import('./view-cache');
    await invalidate({
      view: mid,
      upstream: [registry[0]],
      cacheDir,
      registry,
    });

    const reEvaluated = await resolveView({ view: leaf, registry, cacheDir });
    expect(
      reEvaluated.getQuads(null, null, null, null).map((q) => q.subject.value).sort(),
    ).toEqual(['http://example.org/one', 'http://example.org/two']);
  });

  it('after TTL expiry the resolver re-evaluates upstream', async () => {
    const a = join(dataDir, 'a.ttl');
    await writeFile(
      a,
      '@prefix ex: <http://example.org/> . ex:one ex:p ex:v .',
    );
    const registry = parseSourceSpecs([
      { id: 'raw', glob: a },
      {
        id: 'cached',
        from: ['@raw'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1s' },
      },
    ]);
    const view = registry[1] as ParsedViewSource;

    let nowMs = 1_000_000;
    const opts = {
      view,
      registry,
      cacheDir,
      now: () => nowMs,
    };
    const first = await resolveView(opts);
    expect(first.getQuads(null, null, null, null)).toHaveLength(1);

    // Change upstream
    await writeFile(
      a,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:one ex:p ex:v .',
        'ex:two ex:p ex:v .',
      ].join('\n'),
    );

    // Within ttl: still cached, only one quad.
    nowMs += 500;
    const second = await resolveView(opts);
    expect(second.getQuads(null, null, null, null)).toHaveLength(1);

    // Past ttl: cache stale, re-evaluates.
    nowMs += 1000;
    const third = await resolveView(opts);
    expect(third.getQuads(null, null, null, null)).toHaveLength(2);
  });
});
