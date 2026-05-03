import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataFactory, Store } from 'n3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseSourceSpecs,
  type ParsedSource,
  type ParsedViewSource,
} from './source-spec';
import {
  clearCacheDir,
  invalidate,
  listCachedEntries,
  lookup,
  removeCacheEntry,
  resolveViewCacheDir,
  storeView,
  viewCacheKey,
} from './view-cache';

function makeStore(triples: Array<[string, string, string]>): Store {
  const s = new Store();
  for (const [su, p, o] of triples) {
    s.addQuad(
      DataFactory.quad(
        DataFactory.namedNode(su),
        DataFactory.namedNode(p),
        DataFactory.namedNode(o),
      ),
    );
  }
  return s;
}

function cachedViewBinding(opts: {
  cacheDir: string;
  registry: ReadonlyArray<ParsedSource>;
  viewIndex: number;
  upstreamIndices: number[];
  now?: () => number;
}) {
  const view = opts.registry[opts.viewIndex] as ParsedViewSource;
  return {
    view,
    upstream: opts.upstreamIndices.map((i) => opts.registry[i]),
    cacheDir: opts.cacheDir,
    now: opts.now,
  };
}

describe('view-cache — lookup', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'sparqly-view-cache-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("returns 'miss' when nothing has been stored for the binding", async () => {
    const registry = parseSourceSpecs([
      { id: 'raw', glob: 'data/*.ttl' },
      {
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
    ]);
    const result = await lookup(
      cachedViewBinding({
        cacheDir,
        registry,
        viewIndex: 1,
        upstreamIndices: [0],
      }),
    );
    expect(result.freshness).toBe('miss');
    expect(result.store).toBeUndefined();
  });

  it("returns 'fresh' with the same quads after a store + lookup roundtrip", async () => {
    const registry = parseSourceSpecs([
      { id: 'raw', glob: 'data/*.ttl' },
      {
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
    ]);
    const binding = cachedViewBinding({
      cacheDir,
      registry,
      viewIndex: 1,
      upstreamIndices: [0],
    });
    const original = makeStore([
      [
        'http://example.org/keep',
        'http://example.org/p',
        'http://example.org/v1',
      ],
      [
        'http://example.org/also',
        'http://example.org/p',
        'http://example.org/v2',
      ],
    ]);
    await storeView(binding, original);

    const round = await lookup(binding);
    expect(round.freshness).toBe('fresh');
    expect(round.store).toBeDefined();
    const subjects = (round.store as Store)
      .getQuads(null, null, null, null)
      .map((q) => q.subject.value)
      .sort();
    expect(subjects).toEqual([
      'http://example.org/also',
      'http://example.org/keep',
    ]);
  });
});

describe('view-cache — ttl expiry', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'sparqly-view-cache-ttl-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("returns 'stale' once now() advances past storedAt + ttlMs", async () => {
    const registry = parseSourceSpecs([
      { id: 'raw', glob: 'data/*.ttl' },
      {
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1s' },
      },
    ]);
    let nowMs = 1_000_000;
    const binding = cachedViewBinding({
      cacheDir,
      registry,
      viewIndex: 1,
      upstreamIndices: [0],
      now: () => nowMs,
    });
    const original = makeStore([
      [
        'http://example.org/x',
        'http://example.org/p',
        'http://example.org/y',
      ],
    ]);
    await storeView(binding, original);

    nowMs += 500;
    expect((await lookup(binding)).freshness).toBe('fresh');

    nowMs += 1000;
    expect((await lookup(binding)).freshness).toBe('stale');
  });
});

describe('view-cache — everlasting strategy', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'sparqly-view-cache-everlasting-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  function everlastingRegistry() {
    return parseSourceSpecs([
      { id: 'raw', glob: 'data/*.ttl' },
      {
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { everlasting: true },
      },
    ]);
  }

  it("stays 'fresh' even after the clock advances arbitrarily", async () => {
    const registry = everlastingRegistry();
    let nowMs = 1_000_000;
    const binding = cachedViewBinding({
      cacheDir,
      registry,
      viewIndex: 1,
      upstreamIndices: [0],
      now: () => nowMs,
    });
    await storeView(binding, makeStore([
      ['http://example.org/x', 'http://example.org/p', 'http://example.org/y'],
    ]));

    nowMs += 10 * 365 * 24 * 60 * 60 * 1000; // ten years later
    const result = await lookup(binding);
    expect(result.freshness).toBe('fresh');
    expect(result.store?.getQuads(null, null, null, null)).toHaveLength(1);
  });

  it("becomes 'miss' once invalidate() runs (manual clear)", async () => {
    const registry = everlastingRegistry();
    const binding = cachedViewBinding({
      cacheDir,
      registry,
      viewIndex: 1,
      upstreamIndices: [0],
    });
    await storeView(binding, makeStore([
      ['http://example.org/x', 'http://example.org/p', 'http://example.org/y'],
    ]));
    expect((await lookup(binding)).freshness).toBe('fresh');

    await invalidate(binding);
    expect((await lookup(binding)).freshness).toBe('miss');
  });

  it("survives a fresh binding instance (process-restart simulation)", async () => {
    const registry = everlastingRegistry();
    const writeBinding = cachedViewBinding({
      cacheDir,
      registry,
      viewIndex: 1,
      upstreamIndices: [0],
    });
    await storeView(writeBinding, makeStore([
      ['http://example.org/x', 'http://example.org/p', 'http://example.org/y'],
    ]));

    // Build a *new* binding object reading the same cacheDir; same view spec is
    // re-parsed from scratch as a process restart would do.
    const reopenedRegistry = everlastingRegistry();
    const readBinding = cachedViewBinding({
      cacheDir,
      registry: reopenedRegistry,
      viewIndex: 1,
      upstreamIndices: [0],
    });
    const result = await lookup(readBinding);
    expect(result.freshness).toBe('fresh');
    expect(result.store?.getQuads(null, null, null, null)).toHaveLength(1);
  });
});

describe('view-cache — freshness ASK strategy', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'sparqly-view-cache-freshness-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  function freshnessRegistry(askQuery: string) {
    return parseSourceSpecs([
      { id: 'raw', glob: 'data/*.ttl' },
      {
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { freshness: askQuery },
      },
    ]);
  }

  it("returns 'fresh' when the ASK probe over the upstream returns true", async () => {
    const registry = freshnessRegistry(
      'PREFIX ex: <http://example.org/> ASK { ex:probe ex:still ex:current }',
    );
    const probeStore = makeStore([
      ['http://example.org/probe', 'http://example.org/still', 'http://example.org/current'],
    ]);
    const binding = {
      ...cachedViewBinding({
        cacheDir,
        registry,
        viewIndex: 1,
        upstreamIndices: [0],
      }),
      loadProbeStore: async () => probeStore,
    };
    await storeView(binding, makeStore([
      ['http://example.org/x', 'http://example.org/p', 'http://example.org/y'],
    ]));

    const result = await lookup(binding);
    expect(result.freshness).toBe('fresh');
    expect(result.store?.getQuads(null, null, null, null)).toHaveLength(1);
  });

  it("returns 'stale' when the ASK probe over the upstream returns false", async () => {
    const registry = freshnessRegistry(
      'PREFIX ex: <http://example.org/> ASK { ex:probe ex:still ex:current }',
    );
    const staleProbeStore = makeStore([
      ['http://example.org/something', 'http://example.org/else', 'http://example.org/entirely'],
    ]);
    const binding = {
      ...cachedViewBinding({
        cacheDir,
        registry,
        viewIndex: 1,
        upstreamIndices: [0],
      }),
      loadProbeStore: async () => staleProbeStore,
    };
    await storeView(binding, makeStore([
      ['http://example.org/x', 'http://example.org/p', 'http://example.org/y'],
    ]));

    const result = await lookup(binding);
    expect(result.freshness).toBe('stale');
  });
});

describe('view-cache — cache key composition', () => {
  it('changes when the view query text changes', () => {
    const upstream = parseSourceSpecs([{ id: 'raw', glob: 'data/*.ttl' }])[0];
    const a = parseSourceSpecs([
      {
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
    ])[0] as ParsedViewSource;
    const b = parseSourceSpecs([
      {
        id: 'cached',
        from: '@raw',
        query:
          'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s != ?o) }',
        cache: { ttl: '1h' },
      },
    ])[0] as ParsedViewSource;
    const ka = viewCacheKey({ view: a, upstream: [upstream], cacheDir: '/x' });
    const kb = viewCacheKey({ view: b, upstream: [upstream], cacheDir: '/x' });
    expect(ka).not.toEqual(kb);
  });

  it('changes when the resolved upstream config changes (glob path)', () => {
    const view = parseSourceSpecs([
      {
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
    ])[0] as ParsedViewSource;
    const u1 = parseSourceSpecs([{ id: 'raw', glob: 'data/*.ttl' }])[0];
    const u2 = parseSourceSpecs([{ id: 'raw', glob: 'other/*.ttl' }])[0];
    const k1 = viewCacheKey({ view, upstream: [u1], cacheDir: '/x' });
    const k2 = viewCacheKey({ view, upstream: [u2], cacheDir: '/x' });
    expect(k1).not.toEqual(k2);
  });

  it('changes when an endpoint upstream URL changes', () => {
    const view = parseSourceSpecs([
      {
        id: 'cached',
        from: '@live',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
    ])[0] as ParsedViewSource;
    const u1 = parseSourceSpecs([
      { id: 'live', endpoint: 'https://a.example/sparql' },
    ])[0];
    const u2 = parseSourceSpecs([
      { id: 'live', endpoint: 'https://b.example/sparql' },
    ])[0];
    const k1 = viewCacheKey({ view, upstream: [u1], cacheDir: '/x' });
    const k2 = viewCacheKey({ view, upstream: [u2], cacheDir: '/x' });
    expect(k1).not.toEqual(k2);
  });

  it("changes when an ancestor view's resolved upstream config changes (two-deep chain)", () => {
    const registryV1 = parseSourceSpecs([
      { id: 'raw', glob: 'data/*.ttl' },
      {
        id: 'a',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
      {
        id: 'b',
        from: '@a',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
    ]);
    const registryV2 = parseSourceSpecs([
      { id: 'raw', glob: 'other/*.ttl' },
      {
        id: 'a',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
      {
        id: 'b',
        from: '@a',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
    ]);
    const k1 = viewCacheKey({
      view: registryV1[2] as ParsedViewSource,
      upstream: [registryV1[1]],
      registry: registryV1,
      cacheDir: '/x',
    });
    const k2 = viewCacheKey({
      view: registryV2[2] as ParsedViewSource,
      upstream: [registryV2[1]],
      registry: registryV2,
      cacheDir: '/x',
    });
    expect(k1).not.toEqual(k2);
  });

  it("changes when an ancestor view's query changes (two-deep chain)", () => {
    const registryV1 = parseSourceSpecs([
      { id: 'raw', glob: 'data/*.ttl' },
      {
        id: 'a',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
      {
        id: 'b',
        from: '@a',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
    ]);
    const registryV2 = parseSourceSpecs([
      { id: 'raw', glob: 'data/*.ttl' },
      {
        id: 'a',
        from: '@raw',
        query:
          'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s != ?o) }',
      },
      {
        id: 'b',
        from: '@a',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
    ]);
    const k1 = viewCacheKey({
      view: registryV1[2] as ParsedViewSource,
      upstream: [registryV1[1]],
      registry: registryV1,
      cacheDir: '/x',
    });
    const k2 = viewCacheKey({
      view: registryV2[2] as ParsedViewSource,
      upstream: [registryV2[1]],
      registry: registryV2,
      cacheDir: '/x',
    });
    expect(k1).not.toEqual(k2);
  });

  it('is stable when only cacheDir (an output knob) changes', () => {
    const view = parseSourceSpecs([
      {
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
    ])[0] as ParsedViewSource;
    const upstream = parseSourceSpecs([
      { id: 'raw', glob: 'data/*.ttl' },
    ])[0];
    expect(
      viewCacheKey({ view, upstream: [upstream], cacheDir: '/a' }),
    ).toEqual(viewCacheKey({ view, upstream: [upstream], cacheDir: '/b' }));
  });
});

describe('view-cache — DAG-walk invalidation', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'sparqly-view-cache-dag-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("returns 'stale' on a descendant when an ancestor view's cache entry has been invalidated", async () => {
    const registry = parseSourceSpecs([
      { id: 'raw', glob: 'data/*.ttl' },
      {
        id: 'a',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
      {
        id: 'b',
        from: '@a',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
    ]);
    const a = registry[1] as ParsedViewSource;
    const b = registry[2] as ParsedViewSource;
    const sample = makeStore([
      ['http://example.org/x', 'http://example.org/p', 'http://example.org/y'],
    ]);
    const aBinding = {
      view: a,
      upstream: [registry[0]],
      cacheDir,
      registry,
    };
    const bBinding = {
      view: b,
      upstream: [a],
      cacheDir,
      registry,
    };
    await storeView(aBinding, sample);
    await storeView(bBinding, sample);
    expect((await lookup(bBinding)).freshness).toBe('fresh');

    await invalidate(aBinding);
    expect((await lookup(bBinding)).freshness).toBe('stale');
  });
});

describe('view-cache — cacheDir resolution', () => {
  function viewWithoutOverride(): ParsedViewSource {
    return parseSourceSpecs([
      {
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
    ])[0] as ParsedViewSource;
  }

  function viewWithOverride(cacheDir: string): ParsedViewSource {
    return parseSourceSpecs([
      {
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h', cacheDir },
      },
    ])[0] as ParsedViewSource;
  }

  it('defaults to .sparqly/cache/ next to the loaded config file', () => {
    expect(
      resolveViewCacheDir({
        view: viewWithoutOverride(),
        configPath: '/repo/sparqly.query.yaml',
      }),
    ).toBe('/repo/.sparqly/cache');
  });

  it('falls back to cwd-based .sparqly/cache when no configPath is given', () => {
    expect(
      resolveViewCacheDir({ view: viewWithoutOverride() }),
    ).toBe(join(process.cwd(), '.sparqly/cache'));
  });

  it('honours an absolute per-view cacheDir override', () => {
    expect(
      resolveViewCacheDir({
        view: viewWithOverride('/var/cache/sparqly'),
        configPath: '/repo/sparqly.query.yaml',
      }),
    ).toBe('/var/cache/sparqly');
  });

  it('resolves a relative per-view cacheDir against the config directory', () => {
    expect(
      resolveViewCacheDir({
        view: viewWithOverride('./cache-here'),
        configPath: '/repo/nested/sparqly.query.yaml',
      }),
    ).toBe('/repo/nested/cache-here');
  });
});

describe('view-cache — listCachedEntries', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'sparqly-view-cache-list-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  function ttlRegistry() {
    return parseSourceSpecs([
      { id: 'raw', glob: 'data/*.ttl' },
      {
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
    ]);
  }

  it('returns an empty array for an empty cacheDir', async () => {
    expect(await listCachedEntries(cacheDir)).toEqual([]);
  });

  it('returns one entry per stored view, with id, strategy, size, age, and freshness', async () => {
    const registry = ttlRegistry();
    let nowMs = 1_000_000;
    const binding = cachedViewBinding({
      cacheDir,
      registry,
      viewIndex: 1,
      upstreamIndices: [0],
      now: () => nowMs,
    });
    await storeView(
      binding,
      makeStore([
        ['http://example.org/x', 'http://example.org/p', 'http://example.org/y'],
      ]),
    );

    nowMs += 250;
    const entries = await listCachedEntries(cacheDir, { now: () => nowMs });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'cached',
      strategy: 'ttl',
      ageMs: 250,
      freshness: 'fresh',
    });
    expect(entries[0].sizeBytes).toBeGreaterThan(0);
  });

  it("reports 'stale' on a ttl entry whose ttl has elapsed", async () => {
    const registry = parseSourceSpecs([
      { id: 'raw', glob: 'data/*.ttl' },
      {
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1s' },
      },
    ]);
    let nowMs = 1_000_000;
    const binding = cachedViewBinding({
      cacheDir,
      registry,
      viewIndex: 1,
      upstreamIndices: [0],
      now: () => nowMs,
    });
    await storeView(
      binding,
      makeStore([
        ['http://example.org/x', 'http://example.org/p', 'http://example.org/y'],
      ]),
    );

    nowMs += 5000;
    const entries = await listCachedEntries(cacheDir, { now: () => nowMs });
    expect(entries[0].freshness).toBe('stale');
  });
});

describe('view-cache — clearCacheDir', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'sparqly-view-cache-clear-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('removes every cached entry under cacheDir', async () => {
    const registry = parseSourceSpecs([
      { id: 'raw', glob: 'data/*.ttl' },
      {
        id: 'a',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
      {
        id: 'b',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s != ?o) }',
        cache: { everlasting: true },
      },
    ]);
    const a = cachedViewBinding({
      cacheDir,
      registry,
      viewIndex: 1,
      upstreamIndices: [0],
    });
    const b = cachedViewBinding({
      cacheDir,
      registry,
      viewIndex: 2,
      upstreamIndices: [0],
    });
    const sample = makeStore([
      ['http://example.org/x', 'http://example.org/p', 'http://example.org/y'],
    ]);
    await storeView(a, sample);
    await storeView(b, sample);
    expect(await listCachedEntries(cacheDir)).toHaveLength(2);

    const removed = await clearCacheDir(cacheDir);
    expect(removed).toBe(2);
    expect(await listCachedEntries(cacheDir)).toEqual([]);
  });

  it('returns 0 and does not throw when cacheDir does not exist', async () => {
    const removed = await clearCacheDir(join(cacheDir, 'does-not-exist'));
    expect(removed).toBe(0);
  });
});

describe('view-cache — removeCacheEntry', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'sparqly-view-cache-remove-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  function twoCachedViewsRegistry() {
    return parseSourceSpecs([
      { id: 'raw', glob: 'data/*.ttl' },
      {
        id: 'a',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
      {
        id: 'b',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s != ?o) }',
        cache: { ttl: '1h' },
      },
    ]);
  }

  it('removes only the entry whose id matches', async () => {
    const registry = twoCachedViewsRegistry();
    const aBinding = cachedViewBinding({
      cacheDir,
      registry,
      viewIndex: 1,
      upstreamIndices: [0],
    });
    const bBinding = cachedViewBinding({
      cacheDir,
      registry,
      viewIndex: 2,
      upstreamIndices: [0],
    });
    const sample = makeStore([
      ['http://example.org/x', 'http://example.org/p', 'http://example.org/y'],
    ]);
    await storeView(aBinding, sample);
    await storeView(bBinding, sample);

    await removeCacheEntry(cacheDir, 'a');

    const remaining = await listCachedEntries(cacheDir);
    expect(remaining.map((e) => e.id)).toEqual(['b']);
  });

  it('throws a clear error referencing the unknown id and the known ids', async () => {
    const registry = twoCachedViewsRegistry();
    const aBinding = cachedViewBinding({
      cacheDir,
      registry,
      viewIndex: 1,
      upstreamIndices: [0],
    });
    await storeView(
      aBinding,
      makeStore([
        ['http://example.org/x', 'http://example.org/p', 'http://example.org/y'],
      ]),
    );

    await expect(removeCacheEntry(cacheDir, 'zzz')).rejects.toThrow(
      /no cached entry with id "zzz".*known: a/i,
    );
  });
});
