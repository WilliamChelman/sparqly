import { describe, expect, it } from 'vitest';
import { parseSourceSpecs } from '../sources';
import { resolveServeScopeResult } from './resolve-serve-scope-result';

describe('resolveServeScopeResult — ok paths', () => {
  it('serves the whole non-reference registry and keeps it all resolvable', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'live', endpoint: 'https://example.com/sparql' },
    ]);

    const scope = resolveServeScopeResult(registry)._unsafeUnwrap();

    expect(scope.servedRegistry).toEqual(registry);
  });

  it('serves only the referenced entry but keeps the full registry resolvable', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'live', endpoint: 'https://example.com/sparql' },
    ]);

    const scope = resolveServeScopeResult(registry, '@live')._unsafeUnwrap();

    expect(scope.servedRegistry).toEqual([
      { kind: 'endpoint', id: 'live', endpoint: 'https://example.com/sparql' },
    ]);
    expect(scope.defaultId).toBe('live');
  });

  it('synthesizes a single @default entry for an inline glob/URL target', () => {
    const registry = parseSourceSpecs([{ id: 'files', glob: 'data/*.ttl' }]);

    const scope = resolveServeScopeResult(
      registry,
      'adhoc/*.ttl',
    )._unsafeUnwrap();

    expect(scope.servedRegistry).toEqual([
      { kind: 'glob', glob: 'adhoc/*.ttl', id: 'default', default: true },
    ]);
    expect(scope.defaultId).toBe('default');
  });

  it('normalizes a single id-less source to @default with default: true', () => {
    const registry = parseSourceSpecs([{ glob: 'data/*.ttl' }]);

    const scope = resolveServeScopeResult(registry)._unsafeUnwrap();

    expect(scope.servedRegistry).toEqual([
      { kind: 'glob', glob: 'data/*.ttl', id: 'default', default: true },
    ]);
    expect(scope.defaultId).toBe('default');
  });

  it('returns empty served/resolution sets and no default for an empty registry', () => {
    const scope = resolveServeScopeResult([])._unsafeUnwrap();

    expect(scope.servedRegistry).toEqual([]);
    expect(scope.defaultId).toBeUndefined();
  });

  it('never serves a `kind: reference` alias', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      '@files',
    ]);

    const scope = resolveServeScopeResult(registry)._unsafeUnwrap();

    expect(scope.servedRegistry).toEqual([
      { kind: 'glob', id: 'files', glob: 'data/*.ttl' },
    ]);
  });

  it('synthesizes a single @default pass-through endpoint entry for an inline URL', () => {
    const registry = parseSourceSpecs([{ id: 'files', glob: 'data/*.ttl' }]);

    const scope = resolveServeScopeResult(
      registry,
      'https://example.com/other',
    )._unsafeUnwrap();

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

  it('leaves a single source that already has an id untouched', () => {
    const registry = parseSourceSpecs([{ id: 'files', glob: 'data/*.ttl' }]);

    const scope = resolveServeScopeResult(registry)._unsafeUnwrap();

    expect(scope.servedRegistry).toEqual(registry);
    expect(scope.defaultId).toBe('files');
  });
});

describe('resolveServeScopeResult — default recompute', () => {
  it('keeps the surviving `default: true` marker as the default', () => {
    const registry = parseSourceSpecs([
      { id: 'a', glob: 'a/*.ttl', default: true },
      { id: 'b', glob: 'b/*.ttl' },
    ]);

    expect(resolveServeScopeResult(registry)._unsafeUnwrap().defaultId).toBe(
      'a',
    );
  });

  it('falls back to the sole served entry when the default marker is filtered away', () => {
    const registry = parseSourceSpecs([
      { id: 'a', glob: 'a/*.ttl', default: true },
      { id: 'b', glob: 'b/*.ttl' },
    ]);

    expect(
      resolveServeScopeResult(registry, '@b')._unsafeUnwrap().defaultId,
    ).toBe('b');
  });

  it('has no default with two-plus served sources and no marker', () => {
    const registry = parseSourceSpecs([
      { id: 'a', glob: 'a/*.ttl' },
      { id: 'b', glob: 'b/*.ttl' },
    ]);

    expect(
      resolveServeScopeResult(registry)._unsafeUnwrap().defaultId,
    ).toBeUndefined();
  });
});

describe('resolveServeScopeResult — err variants', () => {
  it('errs `unknown-ref` with the offending ref and availableIds', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'live', endpoint: 'https://example.com/sparql' },
    ]);

    const result = resolveServeScopeResult(registry, '@nope');

    const error = result._unsafeUnwrapErr();
    expect(error.kind).toBe('unknown-ref');
    expect(error.ref).toBe('@nope');
    expect(error.availableIds).toEqual(['files', 'live']);
  });

  it('excludes `kind: reference` entries from availableIds in unknown-ref err', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      '@files',
    ]);

    const error = resolveServeScopeResult(
      registry,
      '@nope',
    )._unsafeUnwrapErr();
    expect(error.kind).toBe('unknown-ref');
    if (error.kind === 'unknown-ref') {
      expect(error.availableIds).toEqual(['files']);
    }
  });
});
