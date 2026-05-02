import { describe, expect, it } from 'vitest';
import { resolveSourceReferences } from './resolve-source-references';

describe('resolveSourceReferences', () => {
  it('returns inputs unchanged when no @id references are present', () => {
    const inputs = ['a/*.ttl', { glob: 'b/*.ttl' }];
    const out = resolveSourceReferences(inputs, { registry: null });
    expect(out).toEqual(inputs);
  });

  it('inlines the registry object for an @id reference and strips the id', () => {
    const registry = [
      {
        id: 'main',
        glob: 'data/*.ttl',
        graphMode: 'flatten' as const,
        graph: 'urn:my:graph',
      },
    ];
    const out = resolveSourceReferences(['@main'], { registry });
    expect(out).toEqual([
      { glob: 'data/*.ttl', graphMode: 'flatten', graph: 'urn:my:graph' },
    ]);
  });

  it('preserves order when mixing @id and glob entries in the active list', () => {
    const registry = [{ id: 'vocab', glob: 'vocab/*.ttl' }];
    const out = resolveSourceReferences(
      ['a/*.ttl', '@vocab', 'b/*.ttl'],
      { registry },
    );
    expect(out).toEqual([
      'a/*.ttl',
      { glob: 'vocab/*.ttl' },
      'b/*.ttl',
    ]);
  });

  it('does not mutate the registry entry when inlining (defensive copy)', () => {
    const registry = [{ id: 'main', glob: 'data/*.ttl' }];
    const out = resolveSourceReferences(['@main'], { registry });
    expect(registry[0]).toEqual({ id: 'main', glob: 'data/*.ttl' });
    expect(out[0]).not.toBe(registry[0]);
  });

  it('throws on an unknown @id, listing the defined ids', () => {
    const registry = [
      { id: 'one', glob: 'a/*.ttl' },
      { id: 'two', glob: 'b/*.ttl' },
    ];
    expect(() =>
      resolveSourceReferences(['@three'], { registry }),
    ).toThrow(/unknown @id reference "@three".*@one.*@two/s);
  });

  it('reports <none> when no ids are defined in the registry', () => {
    expect(() =>
      resolveSourceReferences(['@nope'], { registry: [] }),
    ).toThrow(/unknown @id reference "@nope".*<none>/s);
  });

  it('throws "no config loaded" when registry is null and a reference is encountered', () => {
    expect(() =>
      resolveSourceReferences(['@main'], { registry: null }),
    ).toThrow(/cannot resolve @id reference "@main".*no config file is loaded/);
  });

  it('does not error on no-config when there are no references', () => {
    expect(() =>
      resolveSourceReferences(['data/*.ttl'], { registry: null }),
    ).not.toThrow();
  });
});
