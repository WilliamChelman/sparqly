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
  lookup,
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
        from: ['@raw'],
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
        from: ['@raw'],
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
        from: ['@raw'],
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

describe('view-cache — cache key composition', () => {
  it('changes when the view query text changes', () => {
    const upstream = parseSourceSpecs([{ id: 'raw', glob: 'data/*.ttl' }])[0];
    const a = parseSourceSpecs([
      {
        id: 'cached',
        from: ['@raw'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
    ])[0] as ParsedViewSource;
    const b = parseSourceSpecs([
      {
        id: 'cached',
        from: ['@raw'],
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
        from: ['@raw'],
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
        from: ['@live'],
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

  it('is stable when only cacheDir (an output knob) changes', () => {
    const view = parseSourceSpecs([
      {
        id: 'cached',
        from: ['@raw'],
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

describe('view-cache — cacheDir resolution', () => {
  function viewWithoutOverride(): ParsedViewSource {
    return parseSourceSpecs([
      {
        id: 'cached',
        from: ['@raw'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      },
    ])[0] as ParsedViewSource;
  }

  function viewWithOverride(cacheDir: string): ParsedViewSource {
    return parseSourceSpecs([
      {
        id: 'cached',
        from: ['@raw'],
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
