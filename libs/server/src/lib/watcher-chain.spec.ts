import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSourceSpecs } from 'core';
import { buildWatcherChain } from './watcher-chain';

describe('buildWatcherChain', () => {
  it('mixed glob + endpoint registry: glob source has a watch plan; endpoint source goes to passThrough', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'remote', endpoint: 'https://example.com/sparql' },
    ]);

    const chain = buildWatcherChain(registry);

    expect(chain.sources.map((s) => s.id)).toEqual(['files']);
    expect(chain.sources[0]?.globs).toEqual(['data/*.ttl']);
    expect(chain.passThrough.map((s) => (s as { id?: string }).id)).toEqual([
      'remote',
    ]);
    expect(chain.globBases).toEqual([resolve('data')]);
  });

  it('inline glob (single-source mode): plan with id=undefined, no passThrough', () => {
    const registry = parseSourceSpecs(['data/*.ttl']);

    const chain = buildWatcherChain(registry);

    expect(chain.sources).toHaveLength(1);
    expect(chain.sources[0]?.id).toBeUndefined();
    expect(chain.sources[0]?.globs).toEqual(['data/*.ttl']);
    expect(chain.sources[0]?.views).toEqual([]);
    expect(chain.sources[0]?.cachedViews).toEqual([]);
    expect(chain.passThrough).toEqual([]);
  });

  it('inline endpoint (single-source mode): no plans, source goes to passThrough', () => {
    const registry = parseSourceSpecs(['https://example.com/sparql']);

    const chain = buildWatcherChain(registry);

    expect(chain.sources).toEqual([]);
    expect(chain.passThrough).toHaveLength(1);
    expect(chain.passThrough[0].kind).toBe('endpoint');
    expect(chain.globBases).toEqual([]);
  });

  it('view target with glob upstream and cache.ttl: plan walks the chain; both the glob source and the view get plans', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      {
        id: 'scoped',
        from: '@files',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '5m' },
      },
    ]);

    const chain = buildWatcherChain(registry);

    expect(chain.sources.map((s) => s.id)).toEqual(['files', 'scoped']);

    const scoped = chain.sources.find((s) => s.id === 'scoped');
    expect(scoped?.globs).toEqual(['data/*.ttl']);
    expect(scoped?.views.map((v) => v.id)).toEqual(['scoped']);
    expect(scoped?.cachedViews.map((v) => v.id)).toEqual(['scoped']);
    expect(scoped?.chain).toHaveLength(2);

    const files = chain.sources.find((s) => s.id === 'files');
    expect(files?.globs).toEqual(['data/*.ttl']);
    expect(files?.views).toEqual([]);
    expect(files?.cachedViews).toEqual([]);

    // Single chokidar base — both plans share `data/`.
    expect(chain.globBases).toEqual([resolve('data')]);
  });

  it('view with freshness cache on an empty upstream: plan has no globs but has the cached view; the empty source is passThrough', () => {
    const registry = parseSourceSpecs([
      { id: 'fed', empty: true },
      {
        id: 'live',
        from: '@fed',
        query:
          'CONSTRUCT { ?s ?p ?o } WHERE { SERVICE <https://e/sparql> { ?s ?p ?o } }',
        cache: { freshness: 'ASK { ?s ?p ?o }' },
      },
    ]);

    const chain = buildWatcherChain(registry);

    expect(chain.sources.map((s) => s.id)).toEqual(['live']);
    const live = chain.sources[0];
    expect(live.globs).toEqual([]);
    expect(live.cachedViews.map((v) => v.id)).toEqual(['live']);
    expect(live.chain.map((s) => (s as { id?: string }).id)).toEqual([
      'live',
      'fed',
    ]);

    expect(chain.passThrough.map((s) => (s as { id?: string }).id)).toEqual([
      'fed',
    ]);
  });

  it('walks deeply nested from: chains (view -> view -> glob); each registry source gets its own plan', () => {
    const registry = parseSourceSpecs([
      { id: 'unrelated', glob: 'other/*.ttl' },
      { id: 'leaf', glob: 'data/*.ttl' },
      {
        id: 'mid',
        from: '@leaf',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
      {
        id: 'top',
        from: '@mid',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '5m' },
      },
      {
        id: 'unrelatedView',
        from: '@unrelated',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1m' },
      },
    ]);

    const chain = buildWatcherChain(registry);

    expect(chain.sources.map((s) => s.id).sort()).toEqual([
      'leaf',
      'mid',
      'top',
      'unrelated',
      'unrelatedView',
    ]);

    const top = chain.sources.find((s) => s.id === 'top');
    expect(top?.globs).toEqual(['data/*.ttl']);
    expect(top?.views.map((v) => v.id)).toEqual(['top', 'mid']);
    expect(top?.cachedViews.map((v) => v.id)).toEqual(['top']);
    expect(top?.chain.map((s) => (s as { id?: string }).id)).toEqual([
      'top',
      'mid',
      'leaf',
    ]);

    const mid = chain.sources.find((s) => s.id === 'mid');
    // `mid` has no cache, so its chain has no cachedViews — but it still has a
    // glob upstream, which is what makes it watchable.
    expect(mid?.globs).toEqual(['data/*.ttl']);
    expect(mid?.cachedViews).toEqual([]);

    // Two distinct glob bases — `data/` and `other/` — drive one chokidar.
    expect([...chain.globBases].sort()).toEqual(
      [resolve('data'), resolve('other')].sort(),
    );
  });

  it('does not include `everlasting` cache views in cachedViews (no timer/probe needed); the underlying glob source still drives watching', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      {
        id: 'cached',
        from: '@files',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { everlasting: true },
      },
    ]);

    const chain = buildWatcherChain(registry);

    const cached = chain.sources.find((s) => s.id === 'cached');
    expect(cached?.views.map((v) => v.id)).toEqual(['cached']);
    expect(cached?.cachedViews).toEqual([]);
    expect(cached?.globs).toEqual(['data/*.ttl']);
  });

  it('overlapping glob bases across sources dedupe in globBases (one chokidar root)', () => {
    const registry = parseSourceSpecs([
      { id: 'a', glob: 'data/a/*.ttl' },
      { id: 'b', glob: 'data/b/*.ttl' },
      { id: 'c', glob: 'data/a/*.ttl' }, // identical base+pattern as `a`
    ]);

    const chain = buildWatcherChain(registry);

    expect(chain.sources.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect([...chain.globBases].sort()).toEqual(
      [resolve('data/a'), resolve('data/b')].sort(),
    );
  });

  it('view with no cache directly over an endpoint is pass-through (no globs, no cachedViews)', () => {
    const registry = parseSourceSpecs([
      { id: 'remote', endpoint: 'https://example.com/sparql' },
      {
        id: 'wrapped',
        from: '@remote',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);

    const chain = buildWatcherChain(registry);

    expect(chain.sources).toEqual([]);
    expect(chain.passThrough.map((s) => (s as { id?: string }).id).sort()).toEqual(
      ['remote', 'wrapped'].sort(),
    );
  });

  it('skips reference entries entirely (neither plan nor passThrough)', () => {
    const registry = parseSourceSpecs([
      { id: 'real', glob: 'data/*.ttl' },
      '@real',
    ]);

    const chain = buildWatcherChain(registry);

    expect(chain.sources.map((s) => s.id)).toEqual(['real']);
    expect(chain.passThrough).toEqual([]);
  });
});
