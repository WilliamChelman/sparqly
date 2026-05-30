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
