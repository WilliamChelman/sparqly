import { describe, expect, it } from 'vitest';
import { isAdapterFailure } from './cli-errors';
import { formatAdapter } from './format.adapter';

describe('formatAdapter', () => {
  it('rejects --write combined with --check', () => {
    const result = formatAdapter([], { write: true, check: true });
    if (!isAdapterFailure(result)) throw new Error('expected error');
    expect(result.errors[0].kind).toBe('invalid');
    expect(result.errors[0].message).toBe(
      '--write and --check are mutually exclusive',
    );
  });

  it('passes --write through as cliOverrides.write', () => {
    const result = formatAdapter([], { write: true });
    if (isAdapterFailure(result)) throw new Error('expected ok');
    expect(result.cliOverrides.write).toBe(true);
    expect(result.cliOverrides.check).toBeUndefined();
  });

  it('passes --check through as cliOverrides.check', () => {
    const result = formatAdapter([], { check: true });
    if (isAdapterFailure(result)) throw new Error('expected ok');
    expect(result.cliOverrides.check).toBe(true);
    expect(result.cliOverrides.write).toBeUndefined();
  });

  it('passes --out through as cliOverrides.out', () => {
    const result = formatAdapter([], { out: 'results/run.ttl' });
    if (isAdapterFailure(result)) throw new Error('expected ok');
    expect(result.cliOverrides.out).toBe('results/run.ttl');
  });

  it('rejects --out combined with --write', () => {
    const result = formatAdapter([], { out: 'x.ttl', write: true });
    if (!isAdapterFailure(result)) throw new Error('expected error');
    expect(result.errors[0].kind).toBe('invalid');
    expect(result.errors[0].message).toBe(
      '--out cannot be combined with --write or --check',
    );
  });

  it('rejects --out combined with --check', () => {
    const result = formatAdapter([], { out: 'x.ttl', check: true });
    if (!isAdapterFailure(result)) throw new Error('expected error');
    expect(result.errors[0].message).toBe(
      '--out cannot be combined with --write or --check',
    );
  });
});
