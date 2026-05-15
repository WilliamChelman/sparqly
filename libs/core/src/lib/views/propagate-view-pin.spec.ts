import { describe, expect, it } from 'vitest';
import {
  parseSourceSpecs,
  type ParsedSource,
  type ParsedViewSource,
} from '../sources';
import { propagateViewPin } from './propagate-view-pin';

describe('propagateViewPin', () => {
  it('returns the leaf glob with the propagated ref overriding any declared gitRef', () => {
    const registry = parseSourceSpecs([
      { id: 'docs', glob: 'data/*.ttl', gitRef: 'declared-ref' },
      {
        id: 'kept',
        from: '@docs',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);
    const view = registry[1] as ParsedViewSource;

    const result = propagateViewPin(view, 'v1.2.0', registry);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.leafGlob.id).toBe('docs');
    expect(result.value.ref).toBe('v1.2.0');
  });

  it('recurses through an intermediate view down to the leaf glob', () => {
    const registry = parseSourceSpecs([
      { id: 'docs', glob: 'data/*.ttl' },
      {
        id: 'inner',
        from: '@docs',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
      {
        id: 'outer',
        from: '@inner',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);
    const outer = registry[2] as ParsedViewSource;

    const result = propagateViewPin(outer, 'v1.2.0', registry);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.leafGlob.id).toBe('docs');
    expect(result.value.ref).toBe('v1.2.0');
  });

  it('errors when the chain bottoms on a kind:endpoint source, naming the endpoint id', () => {
    const registry = parseSourceSpecs([
      { id: 'live', endpoint: 'http://example.org/sparql' },
      {
        id: 'mid',
        from: '@live',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
      {
        id: 'outer',
        from: '@mid',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);
    const outer = registry[2] as ParsedViewSource;

    const result = propagateViewPin(outer, 'v1.2.0', registry);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('git-pin');
    expect(result.error.message).toMatch(/@outer/);
    expect(result.error.message).toMatch(/@live/);
    expect(result.error.message).toMatch(/endpoint/);
  });

  it('errors when the chain bottoms on a kind:empty source, naming the empty id', () => {
    const registry = parseSourceSpecs([
      { id: 'composer', empty: true },
      {
        id: 'composed',
        from: '@composer',
        query:
          'CONSTRUCT { ?s ?p ?o } WHERE { SERVICE <http://example.org/sparql> { ?s ?p ?o } }',
      },
    ]);
    const view = registry[1] as ParsedViewSource;

    const result = propagateViewPin(view, 'v1.2.0', registry);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('git-pin');
    expect(result.error.message).toMatch(/@composer/);
    expect(result.error.message).toMatch(/empty/);
  });

  it('errors when the chain reaches a kind:reference upstream (unchanged rejection)', () => {
    // Reference entries aren't normally addressable by id, but the view
    // resolver still has to be defensive against a synthetic registry that
    // includes one — the rejection contract should be the same as for other
    // non-pinnable upstreams.
    const aliasEntry = {
      kind: 'reference',
      id: 'alias',
      ref: 'docs',
    } as unknown as ParsedSource;
    const baseRegistry = parseSourceSpecs([
      { id: 'docs', glob: 'data/*.ttl' },
      {
        id: 'view',
        from: '@alias',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);
    const registry: ReadonlyArray<ParsedSource> = [aliasEntry, ...baseRegistry];
    const view = baseRegistry[1] as ParsedViewSource;

    const result = propagateViewPin(view, 'v1.2.0', registry);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('git-pin');
    expect(result.error.message).toMatch(/@view/);
  });
});
