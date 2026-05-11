import { describe, expect, it } from 'vitest';
import { parseSourceSpecs } from './sources';
import { selectTarget } from './select-target';

describe('selectTarget — explicit @ref', () => {
  it('returns the registry entry referenced by `@id`', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'live', endpoint: 'https://example.com/sparql' },
    ]);

    const target = selectTarget(registry, '@live');

    expect(target).toEqual({
      kind: 'endpoint',
      id: 'live',
      endpoint: 'https://example.com/sparql',
    });
  });
});

describe('selectTarget — inline positional', () => {
  it('parses an inline glob string as the target', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'live', endpoint: 'https://example.com/sparql' },
    ]);

    const target = selectTarget(registry, 'adhoc/*.ttl');

    expect(target).toEqual({ kind: 'glob', glob: 'adhoc/*.ttl' });
  });

  it('parses an inline endpoint URL as the target', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
    ]);

    const target = selectTarget(registry, 'https://example.com/other');

    expect(target).toEqual({
      kind: 'endpoint',
      endpoint: 'https://example.com/other',
    });
  });
});

describe('selectTarget — fallback to default:true entry', () => {
  it('returns the entry marked default when no target argument is given', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'live', endpoint: 'https://example.com/sparql', default: true },
    ]);

    const target = selectTarget(registry);

    expect(target).toMatchObject({
      kind: 'endpoint',
      id: 'live',
      default: true,
    });
  });
});

describe('selectTarget — sole-entry fallback', () => {
  it('returns the only registry entry when no target and no default is set', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
    ]);

    const target = selectTarget(registry);

    expect(target).toEqual({ kind: 'glob', id: 'files', glob: 'data/*.ttl' });
  });
});

describe('selectTarget — ambiguous registry', () => {
  it('errors and lists every available `@id` when no target, no default, and >1 entries', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'live', endpoint: 'https://example.com/sparql' },
      { id: 'snap', from: '@live', query: 'SELECT * WHERE { ?s ?p ?o }' },
    ]);

    expect(() => selectTarget(registry)).toThrow(
      /@files.*@live.*@snap/s,
    );
  });

  it('errors with a clear message when the registry is empty', () => {
    expect(() => selectTarget([])).toThrow(/empty/i);
  });
});

describe('selectTarget — reject kind:reference as target', () => {
  it("errors when the sole registry entry is a `kind: 'reference'` alias", () => {
    const registry = parseSourceSpecs(['@other']);

    expect(() => selectTarget(registry)).toThrow(/reference/i);
  });
});

describe('selectTarget — explicit @ref to missing id', () => {
  it('errors and lists the available `@ids` when the ref does not match any entry', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'live', endpoint: 'https://example.com/sparql' },
    ]);

    expect(() => selectTarget(registry, '@nope')).toThrow(
      /@nope.*@files.*@live/s,
    );
  });
});

describe('selectTarget — precedence', () => {
  it('explicit positional/flag wins over a `default: true` entry', () => {
    const registry = parseSourceSpecs([
      { id: 'files', glob: 'data/*.ttl' },
      { id: 'live', endpoint: 'https://example.com/sparql', default: true },
    ]);

    const target = selectTarget(registry, '@files');

    expect(target).toMatchObject({ kind: 'glob', id: 'files' });
  });

  it('explicit inline positional wins over a `default: true` entry', () => {
    const registry = parseSourceSpecs([
      { id: 'live', endpoint: 'https://example.com/sparql', default: true },
    ]);

    const target = selectTarget(registry, 'adhoc/*.ttl');

    expect(target).toEqual({ kind: 'glob', glob: 'adhoc/*.ttl' });
  });
});
