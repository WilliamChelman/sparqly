import { describe, expect, it } from 'vitest';
import { isAdapterFailure } from './cli-errors';
import { diffAdapter } from './diff.adapter';

describe('diffAdapter', () => {
  it('maps the two positionals to left/right', () => {
    const result = diffAdapter(['a/*.ttl', 'b/*.ttl'], {});
    if (isAdapterFailure(result)) throw new Error('expected ok');
    expect(result.cliOverrides.left).toBe('a/*.ttl');
    expect(result.cliOverrides.right).toBe('b/*.ttl');
  });

  it('--left and --right flags override positionals', () => {
    const result = diffAdapter(['posL', 'posR'], {
      left: 'flagL',
      right: 'flagR',
    });
    if (isAdapterFailure(result)) throw new Error('expected ok');
    expect(result.cliOverrides.left).toBe('flagL');
    expect(result.cliOverrides.right).toBe('flagR');
  });

  it('rejects more than two positionals with positional-overflow', () => {
    const result = diffAdapter(['a', 'b', 'c'], {});
    if (!isAdapterFailure(result)) throw new Error('expected error');
    expect(result.errors[0].kind).toBe('positional-overflow');
    expect(result.errors[0].message).toBe(
      'diff takes at most two positional arguments (got 3)',
    );
  });

  it('passes --out through as cliOverrides.out', () => {
    const result = diffAdapter(['a', 'b'], { out: 'patch.txt' });
    if (isAdapterFailure(result)) throw new Error('expected ok');
    expect(result.cliOverrides.out).toBe('patch.txt');
  });

  it('rejects unknown --format with the canonical phrasing (turtle is now valid)', () => {
    const result = diffAdapter([], { format: 'csv' });
    if (!isAdapterFailure(result)) throw new Error('expected error');
    expect(result.errors[0]).toEqual({
      kind: 'unknown-flag',
      message:
        "unknown --format 'csv' (expected human, json, rdf-patch, turtle)",
    });
  });

  it('accepts --format=turtle', () => {
    const result = diffAdapter(['a', 'b'], { format: 'turtle' });
    if (isAdapterFailure(result)) throw new Error('expected ok');
    expect(result.cliOverrides.format).toBe('turtle');
  });

  it('rejects unknown --graph-strategy', () => {
    const result = diffAdapter([], { graphStrategy: 'bogus' });
    if (!isAdapterFailure(result)) throw new Error('expected error');
    expect(result.errors[0]).toEqual({
      kind: 'unknown-flag',
      message:
        "unknown --graph-strategy 'bogus' (expected default, partial, full, none)",
    });
  });
});
