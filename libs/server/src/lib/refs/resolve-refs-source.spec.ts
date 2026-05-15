import { describe, expect, it } from 'vitest';
import { parseSourceSpecs } from 'core';
import { resolveRefsSource } from './resolve-refs-source';

describe('resolveRefsSource — locates the glob whose repo backs ref-discovery', () => {
  it('returns the glob source itself when the id resolves to a glob', () => {
    const registry = parseSourceSpecs([{ id: 'docs', glob: 'data/*.ttl' }]);

    const result = resolveRefsSource('docs', registry);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.kind).toBe('glob');
    expect(result.value.id).toBe('docs');
  });

  it('walks a view chain to its leaf glob (single hop)', () => {
    const registry = parseSourceSpecs([
      { id: 'docs', glob: 'data/*.ttl' },
      {
        id: 'kept',
        from: '@docs',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);

    const result = resolveRefsSource('kept', registry);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.id).toBe('docs');
  });

  it('walks a multi-hop view chain (view → view → glob) to the leaf', () => {
    const registry = parseSourceSpecs([
      { id: 'docs', glob: 'data/*.ttl' },
      {
        id: 'mid',
        from: '@docs',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
      {
        id: 'top',
        from: '@mid',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);

    const result = resolveRefsSource('top', registry);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.id).toBe('docs');
  });

  it('errors no-git-repo kind:endpoint when the source is itself an endpoint', () => {
    const registry = parseSourceSpecs([
      { id: 'live', endpoint: 'https://example.org/sparql' },
    ]);

    const result = resolveRefsSource('live', registry);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error).toEqual({
      kind: 'no-git-repo',
      terminatingKind: 'endpoint',
    });
  });

  it('errors no-git-repo kind:endpoint when a view chain bottoms on an endpoint', () => {
    const registry = parseSourceSpecs([
      { id: 'live', endpoint: 'https://example.org/sparql' },
      {
        id: 'composed',
        from: '@live',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);

    const result = resolveRefsSource('composed', registry);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error).toEqual({
      kind: 'no-git-repo',
      terminatingKind: 'endpoint',
    });
  });

  it('errors no-git-repo kind:empty when a view chain bottoms on an empty source', () => {
    const registry = parseSourceSpecs([
      { id: 'blank', empty: true },
      {
        id: 'composed',
        from: '@blank',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);

    const result = resolveRefsSource('composed', registry);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error).toEqual({
      kind: 'no-git-repo',
      terminatingKind: 'empty',
    });
  });

  it('errors unknown-source when the id is not in the registry', () => {
    const registry = parseSourceSpecs([{ id: 'docs', glob: 'data/*.ttl' }]);

    const result = resolveRefsSource('missing', registry);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('unknown-source');
  });
});
