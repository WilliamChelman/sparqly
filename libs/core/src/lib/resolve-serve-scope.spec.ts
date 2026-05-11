import { describe, expect, it } from 'vitest';
import { parseSourceSpecs } from './source-spec';
import { resolveServeScope } from './resolve-serve-scope';

describe('resolveServeScope — no --source', () => {
  it('serves the whole non-reference registry and keeps it all resolvable', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'live', endpoint: 'https://example.com/sparql' },
    ]);

    const scope = resolveServeScope(registry);

    expect(scope.servedRegistry).toEqual(registry);
    expect(scope.resolutionRegistry).toEqual(registry);
  });
});

describe('resolveServeScope — --source @id', () => {
  it('serves only the referenced entry but keeps the full registry resolvable', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'live', endpoint: 'https://example.com/sparql' },
    ]);

    const scope = resolveServeScope(registry, '@live');

    expect(scope.servedRegistry).toEqual([
      { kind: 'endpoint', id: 'live', endpoint: 'https://example.com/sparql' },
    ]);
    expect(scope.resolutionRegistry).toEqual(registry);
    expect(scope.defaultId).toBe('live');
  });

  it('keeps a view`s `from:` upstream resolvable but unserved', () => {
    const registry = parseSourceSpecs([
      { id: 'upstream', glob: 'data/*.ttl' },
      { id: 'view', from: '@upstream', query: 'SELECT * WHERE { ?s ?p ?o }' },
    ]);

    const scope = resolveServeScope(registry, '@view');

    expect(scope.servedRegistry.map((s) => s.id)).toEqual(['view']);
    expect(scope.resolutionRegistry.map((s) => s.id)).toEqual([
      'upstream',
      'view',
    ]);
  });

  it('throws listing the available ids when the ref matches nothing', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'live', endpoint: 'https://example.com/sparql' },
    ]);

    expect(() => resolveServeScope(registry, '@nope')).toThrow(
      /@nope.*@files.*@live/s,
    );
  });

  it('never serves a `kind: reference` alias', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      '@files',
    ]);

    expect(resolveServeScope(registry).servedRegistry).toEqual([
      { kind: 'glob', id: 'files', glob: 'data/*.ttl' },
    ]);
  });
});

describe('resolveServeScope — empty registry', () => {
  it('returns an empty served set and no default (the server layer reports it)', () => {
    const scope = resolveServeScope([]);

    expect(scope.servedRegistry).toEqual([]);
    expect(scope.resolutionRegistry).toEqual([]);
    expect(scope.defaultId).toBeUndefined();
  });
});

describe('resolveServeScope — default recompute', () => {
  it('keeps the surviving `default: true` marker as the default', () => {
    const registry = parseSourceSpecs([
      { id: 'a', glob: 'a/*.ttl', default: true },
      { id: 'b', glob: 'b/*.ttl' },
    ]);

    expect(resolveServeScope(registry).defaultId).toBe('a');
  });

  it('falls back to the sole served entry when the default marker is filtered away', () => {
    const registry = parseSourceSpecs([
      { id: 'a', glob: 'a/*.ttl', default: true },
      { id: 'b', glob: 'b/*.ttl' },
    ]);

    expect(resolveServeScope(registry, '@b').defaultId).toBe('b');
  });

  it('has no default with two-plus served sources and no marker', () => {
    const registry = parseSourceSpecs([
      { id: 'a', glob: 'a/*.ttl' },
      { id: 'b', glob: 'b/*.ttl' },
    ]);

    expect(resolveServeScope(registry).defaultId).toBeUndefined();
  });
});

describe('resolveServeScope — inline glob/URL', () => {
  it('synthesizes a single @default glob entry, keeping configured sources for resolution only', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'live', endpoint: 'https://example.com/sparql' },
    ]);

    const scope = resolveServeScope(registry, 'adhoc/*.ttl');

    expect(scope.servedRegistry).toEqual([
      { kind: 'glob', glob: 'adhoc/*.ttl', id: 'default', default: true },
    ]);
    expect(scope.defaultId).toBe('default');
    expect(scope.resolutionRegistry).toContainEqual({
      kind: 'glob',
      glob: 'adhoc/*.ttl',
      id: 'default',
      default: true,
    });
    expect(scope.resolutionRegistry).toContainEqual({
      kind: 'glob',
      id: 'files',
      glob: 'data/*.ttl',
    });
  });

  it('synthesizes a single @default pass-through endpoint entry for an inline URL', () => {
    const registry = parseSourceSpecs([{ id: 'files', glob: 'data/*.ttl' }]);

    const scope = resolveServeScope(registry, 'https://example.com/other');

    expect(scope.servedRegistry).toEqual([
      {
        kind: 'endpoint',
        endpoint: 'https://example.com/other',
        id: 'default',
        default: true,
      },
    ]);
    expect(scope.defaultId).toBe('default');
  });
});

describe('resolveServeScope — lone id-less source', () => {
  it('normalizes a single id-less source to @default with default: true', () => {
    const registry = parseSourceSpecs([{ glob: 'data/*.ttl' }]);

    const scope = resolveServeScope(registry);

    expect(scope.servedRegistry).toEqual([
      { kind: 'glob', glob: 'data/*.ttl', id: 'default', default: true },
    ]);
    expect(scope.resolutionRegistry).toEqual(scope.servedRegistry);
    expect(scope.defaultId).toBe('default');
  });

  it('leaves a single source that already has an id untouched', () => {
    const registry = parseSourceSpecs([{ id: 'files', glob: 'data/*.ttl' }]);

    const scope = resolveServeScope(registry);

    expect(scope.servedRegistry).toEqual(registry);
    expect(scope.defaultId).toBe('files');
  });
});
