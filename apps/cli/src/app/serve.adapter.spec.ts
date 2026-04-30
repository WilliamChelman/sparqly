import { describe, expect, it } from 'vitest';
import { isAdapterFailure } from './cli-errors';
import { serveAdapter } from './serve.adapter';

describe('serveAdapter', () => {
  it('passes through valid options as cliOverrides (with coerced port)', () => {
    const result = serveAdapter([], {
      sources: 'data/*.ttl',
      port: 4000,
      graphStrategy: 'full',
      watch: true,
      watchDebounce: 500,
    });
    if (isAdapterFailure(result)) throw new Error('expected ok');
    expect(result.cliOverrides).toEqual({
      sources: 'data/*.ttl',
      port: 4000,
      graphStrategy: 'full',
      watch: true,
      watchDebounce: 500,
    });
  });

  it('rejects unknown --graph-strategy', () => {
    const result = serveAdapter([], { graphStrategy: 'bogus' });
    if (!isAdapterFailure(result)) throw new Error('expected error');
    expect(result.errors[0]).toEqual({
      kind: 'unknown-flag',
      message:
        "unknown --graph-strategy 'bogus' (expected default, partial, full, none)",
    });
  });

  it('--immutable=false produces mutable: true', () => {
    const result = serveAdapter([], { immutable: false });
    if (isAdapterFailure(result)) throw new Error('expected ok');
    expect(result.cliOverrides.mutable).toBe(true);
  });
});
