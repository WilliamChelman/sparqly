import { describe, expect, it } from 'vitest';
import { parseSourceSpecs } from '../sources';
import { selectTargetResult } from './select-target-result';

describe('selectTargetResult — ok paths', () => {
  it('resolves @ref to the matching registry entry', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'live', endpoint: 'https://example.com/sparql' },
    ]);

    const result = selectTargetResult(registry, '@live');

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'endpoint',
      id: 'live',
      endpoint: 'https://example.com/sparql',
    });
  });

  it('parses an inline glob string as the target', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
    ]);

    const result = selectTargetResult(registry, 'adhoc/*.ttl');

    expect(result._unsafeUnwrap()).toEqual({
      kind: 'glob',
      glob: 'adhoc/*.ttl',
    });
  });

  it('parses an inline endpoint URL as the target', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
    ]);

    const result = selectTargetResult(
      registry,
      'https://example.com/other',
    );

    expect(result._unsafeUnwrap()).toEqual({
      kind: 'endpoint',
      endpoint: 'https://example.com/other',
    });
  });

  it('falls back to the `default: true` entry when no target is given', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'live', endpoint: 'https://example.com/sparql', default: true },
    ]);

    const result = selectTargetResult(registry);

    expect(result._unsafeUnwrap()).toMatchObject({
      kind: 'endpoint',
      id: 'live',
      default: true,
    });
  });

  it('falls back to the sole entry when no target and no default is set', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
    ]);

    const result = selectTargetResult(registry);

    expect(result._unsafeUnwrap()).toEqual({
      kind: 'glob',
      id: 'files',
      glob: 'data/*.ttl',
    });
  });
});

describe('selectTargetResult — precedence', () => {
  it('explicit @ref wins over a `default: true` entry', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'live', endpoint: 'https://example.com/sparql', default: true },
    ]);

    const result = selectTargetResult(registry, '@files');

    expect(result._unsafeUnwrap()).toMatchObject({
      kind: 'glob',
      id: 'files',
    });
  });

  it('explicit inline positional wins over a `default: true` entry', () => {
    const registry = parseSourceSpecs([
      { id: 'live', endpoint: 'https://example.com/sparql', default: true },
    ]);

    const result = selectTargetResult(registry, 'adhoc/*.ttl');

    expect(result._unsafeUnwrap()).toEqual({
      kind: 'glob',
      glob: 'adhoc/*.ttl',
    });
  });
});

describe('selectTargetResult — err variants', () => {
  it('errs `empty-registry` when no target and the registry is empty', () => {
    const result = selectTargetResult([]);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'empty-registry' });
  });

  it('errs `no-default-multi` with availableIds when no target, no default, >1 entries', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'live', endpoint: 'https://example.com/sparql' },
      { id: 'snap', from: '@live', query: 'SELECT * WHERE { ?s ?p ?o }' },
    ]);

    const result = selectTargetResult(registry);

    const err = result._unsafeUnwrapErr();
    expect(err.kind).toBe('no-default-multi');
    if (err.kind === 'no-default-multi') {
      expect(err.availableIds).toEqual(['files', 'live', 'snap']);
    }
  });

  it('errs `ref-as-target` when the selected entry is a `kind: reference` alias', () => {
    const registry = parseSourceSpecs(['@other']);

    const result = selectTargetResult(registry);

    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'ref-as-target' });
  });

  it('errs `unknown-ref` with the offending ref and availableIds', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'live', endpoint: 'https://example.com/sparql' },
    ]);

    const result = selectTargetResult(registry, '@nope');

    const err = result._unsafeUnwrapErr();
    expect(err.kind).toBe('unknown-ref');
    if (err.kind === 'unknown-ref') {
      expect(err.ref).toBe('@nope');
      expect(err.availableIds).toEqual(['files', 'live']);
    }
  });
});
