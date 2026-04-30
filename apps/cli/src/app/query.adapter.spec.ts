import { describe, expect, it } from 'vitest';
import { isAdapterFailure } from './cli-errors';
import { queryAdapter } from './query.adapter';

describe('queryAdapter', () => {
  it('passes through valid options as cliOverrides', () => {
    const result = queryAdapter([], {
      sources: 'data/*.ttl',
      query: 'SELECT ?s WHERE { ?s ?p ?o }',
      format: 'turtle',
      graphStrategy: 'partial',
      verbose: true,
    });

    if (isAdapterFailure(result)) throw new Error('expected ok');
    expect(result.cliOverrides).toEqual({
      sources: 'data/*.ttl',
      query: 'SELECT ?s WHERE { ?s ?p ?o }',
      format: 'turtle',
      graphStrategy: 'partial',
      verbose: true,
    });
  });

  it('rejects an unknown --format with the canonical phrasing', () => {
    const result = queryAdapter([], { format: 'csv' });
    if (!isAdapterFailure(result)) throw new Error('expected error');
    expect(result.errors[0].kind).toBe('unknown-flag');
    expect(result.errors[0].message).toBe(
      "unknown --format 'csv' (expected json, turtle)",
    );
  });

  it('--mutable maps to mutable: true', () => {
    const result = queryAdapter([], { mutable: true });
    if (isAdapterFailure(result)) throw new Error('expected ok');
    expect(result.cliOverrides.mutable).toBe(true);
  });

  it('--immutable=false maps to mutable: true', () => {
    const result = queryAdapter([], { immutable: false });
    if (isAdapterFailure(result)) throw new Error('expected ok');
    expect(result.cliOverrides.mutable).toBe(true);
  });

  it('--immutable=true (or bare --immutable) maps to mutable: false', () => {
    const result = queryAdapter([], { immutable: true });
    if (isAdapterFailure(result)) throw new Error('expected ok');
    expect(result.cliOverrides.mutable).toBe(false);
  });

  it('omits mutable when neither --mutable nor --immutable is given', () => {
    const result = queryAdapter([], { query: 'SELECT ?s WHERE { ?s ?p ?o }' });
    if (isAdapterFailure(result)) throw new Error('expected ok');
    expect('mutable' in result.cliOverrides).toBe(false);
  });

  it('passes --out through as cliOverrides.out', () => {
    const result = queryAdapter([], { out: 'result.json' });
    if (isAdapterFailure(result)) throw new Error('expected ok');
    expect(result.cliOverrides.out).toBe('result.json');
  });

  it('rejects an unknown --graph-strategy with the canonical phrasing', () => {
    const result = queryAdapter([], { graphStrategy: 'bogus' });

    if (!isAdapterFailure(result)) throw new Error('expected error');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].kind).toBe('unknown-flag');
    expect(result.errors[0].message).toBe(
      "unknown --graph-strategy 'bogus' (expected default, partial, full, none)",
    );
  });
});
