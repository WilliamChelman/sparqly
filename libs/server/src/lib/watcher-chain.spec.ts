import { describe, expect, it } from 'vitest';
import { parseSourceSpecs, type ParsedSource } from 'core';
import { buildWatcherChain } from './watcher-chain';

function parse(...inputs: Parameters<typeof parseSourceSpecs>[0]): ParsedSource[] {
  return parseSourceSpecs(inputs);
}

describe('buildWatcherChain', () => {
  it('inline glob target: collects the target glob; no views, registry slice = [target]', () => {
    const target = parse('data/*.ttl')[0];

    const chain = buildWatcherChain([], target);

    expect(chain.globs).toEqual(['data/*.ttl']);
    expect(chain.views).toEqual([]);
    expect(chain.cachedViews).toEqual([]);
    expect(chain.registry).toEqual([target]);
  });

  it('endpoint target: no globs, no views, registry slice = [target]', () => {
    const target = parse('https://example.com/sparql')[0];

    const chain = buildWatcherChain([], target);

    expect(chain.globs).toEqual([]);
    expect(chain.views).toEqual([]);
    expect(chain.cachedViews).toEqual([]);
    expect(chain.registry).toEqual([target]);
  });

  it('view target with glob upstream and cache.ttl: globs=[upstream glob], views=[target], cachedViews=[target], registry=[target, upstream]', () => {
    const registry = parse(
      { id: 'files', glob: 'data/*.ttl' },
      {
        id: 'scoped',
        from: '@files',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '5m' },
      },
    );
    const target = registry.find((s) => s.id === 'scoped') as ParsedSource;

    const chain = buildWatcherChain(registry, target);

    expect(chain.globs).toEqual(['data/*.ttl']);
    expect(chain.views.map((v) => v.id)).toEqual(['scoped']);
    expect(chain.cachedViews.map((v) => v.id)).toEqual(['scoped']);
    expect(chain.registry).toHaveLength(2);
  });

  it('view target with freshness cache on an empty upstream: no globs, target view in views, registry=[target, upstream]', () => {
    const registry = parse(
      { id: 'fed', empty: true },
      {
        id: 'live',
        from: '@fed',
        query:
          'CONSTRUCT { ?s ?p ?o } WHERE { SERVICE <https://e/sparql> { ?s ?p ?o } }',
        cache: { freshness: 'ASK { ?s ?p ?o }' },
      },
    );
    const target = registry.find((s) => s.id === 'live') as ParsedSource;

    const chain = buildWatcherChain(registry, target);

    expect(chain.globs).toEqual([]);
    expect(chain.views.map((v) => v.id)).toEqual(['live']);
    expect(chain.cachedViews.map((v) => v.id)).toEqual(['live']);
    expect(chain.registry.map((s) => s.id)).toEqual(['live', 'fed']);
  });

  it('walks deeply nested from: chains (view -> view -> glob) and excludes untargeted entries', () => {
    const registry = parse(
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
    );
    const target = registry.find((s) => s.id === 'top') as ParsedSource;

    const chain = buildWatcherChain(registry, target);

    expect(chain.globs).toEqual(['data/*.ttl']);
    // All in-chain views (intermediate `mid` is included).
    expect(chain.views.map((v) => v.id)).toEqual(['top', 'mid']);
    // Only `top` has a ttl cache.
    expect(chain.cachedViews.map((v) => v.id)).toEqual(['top']);
    expect(chain.registry.map((s) => s.id)).toEqual(['top', 'mid', 'leaf']);
  });

  it('does not include `everlasting` cache views in cachedViews (no timer/probe needed)', () => {
    const registry = parse(
      { id: 'files', glob: 'data/*.ttl' },
      {
        id: 'cached',
        from: '@files',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { everlasting: true },
      },
    );
    const target = registry.find((s) => s.id === 'cached') as ParsedSource;

    const chain = buildWatcherChain(registry, target);

    expect(chain.views.map((v) => v.id)).toEqual(['cached']);
    expect(chain.cachedViews).toEqual([]);
    expect(chain.globs).toEqual(['data/*.ttl']);
  });
});
