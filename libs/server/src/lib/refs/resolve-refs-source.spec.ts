import { describe, expect, it } from 'vitest';
import { type ParsedFileSource, type ParsedSource, parseSourceSpecs } from 'core';
import { resolveRefsSource } from './resolve-refs-source';

describe('resolveRefsSource — locates the glob whose repo backs ref-discovery', () => {
  it('returns the glob source itself when the id resolves to a glob', () => {
    const registry = parseSourceSpecs([{ id: 'docs', glob: 'data/*.ttl' }]);

    const result = resolveRefsSource('docs', registry);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.glob.kind).toBe('glob');
    expect(result.value.glob.id).toBe('docs');
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
    expect(result.value.glob.id).toBe('docs');
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
    expect(result.value.glob.id).toBe('docs');
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

  it('walks up from a split-glob file child to its parent glob', () => {
    const parsed = parseSourceSpecs([
      { id: 'docs', glob: 'data/*.ttl', splitByFile: true },
    ]);
    const child: ParsedFileSource = {
      kind: 'file',
      id: 'docs/alice.ttl',
      path: '/abs/data/alice.ttl',
      parentId: 'docs',
    };
    const registry: ReadonlyArray<ParsedSource> = [...parsed, child];

    const result = resolveRefsSource('docs/alice.ttl', registry);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.glob.kind).toBe('glob');
    expect(result.value.glob.id).toBe('docs');
  });

  it('exposes the resolved file path on the result for a split-glob file child', () => {
    const parsed = parseSourceSpecs([
      { id: 'docs', glob: 'data/*.ttl', splitByFile: true },
    ]);
    const child: ParsedFileSource = {
      kind: 'file',
      id: 'docs/alice.ttl',
      path: '/abs/data/alice.ttl',
      parentId: 'docs',
    };
    const registry: ReadonlyArray<ParsedSource> = [...parsed, child];

    const result = resolveRefsSource('docs/alice.ttl', registry);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.filePath).toBe('/abs/data/alice.ttl');
  });

  it('does not set filePath when the resolved source is a parent glob', () => {
    const registry = parseSourceSpecs([{ id: 'docs', glob: 'data/*.ttl' }]);

    const result = resolveRefsSource('docs', registry);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.filePath).toBeUndefined();
  });

  it('errors no-git-repo kind:file when a file child has no parent in the registry', () => {
    const orphan: ParsedFileSource = {
      kind: 'file',
      id: 'docs/alice.ttl',
      path: '/abs/data/alice.ttl',
      parentId: 'docs',
    };
    const registry: ReadonlyArray<ParsedSource> = [orphan];

    const result = resolveRefsSource('docs/alice.ttl', registry);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error).toEqual({
      kind: 'no-git-repo',
      terminatingKind: 'file',
    });
  });

  it('errors pin-unsupported when the resolved glob is `storage: disk`', () => {
    // ADR-0041 disk-backed indexes are keyed on `(id, glob)` only — they have
    // no place to record a pinned SHA, so `resolveSourceResult` refuses to
    // resolve them with `gitRef`/`--at`. The refs endpoint must mirror that
    // refusal: advertising a ref list for a source the load path will reject
    // teaches the UI to offer a pin action that always fails downstream.
    const registry = parseSourceSpecs([
      { id: 'docs', glob: 'data/*.ttl', storage: 'disk' },
    ]);

    const result = resolveRefsSource('docs', registry);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error).toEqual({
      kind: 'pin-unsupported',
      reason: 'storage-disk',
    });
  });

  it('errors pin-unsupported when a view chain bottoms on a disk-backed glob', () => {
    const registry = parseSourceSpecs([
      { id: 'docs', glob: 'data/*.ttl', storage: 'disk' },
      {
        id: 'kept',
        from: '@docs',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);

    const result = resolveRefsSource('kept', registry);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error).toEqual({
      kind: 'pin-unsupported',
      reason: 'storage-disk',
    });
  });

  it('errors pin-unsupported when a file child walks up to a disk-backed parent glob', () => {
    const parsed = parseSourceSpecs([
      { id: 'docs', glob: 'data/*.ttl', splitByFile: true, storage: 'disk' },
    ]);
    const child: ParsedFileSource = {
      kind: 'file',
      id: 'docs/alice.ttl',
      path: '/abs/data/alice.ttl',
      parentId: 'docs',
    };
    const registry: ReadonlyArray<ParsedSource> = [...parsed, child];

    const result = resolveRefsSource('docs/alice.ttl', registry);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error).toEqual({
      kind: 'pin-unsupported',
      reason: 'storage-disk',
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
