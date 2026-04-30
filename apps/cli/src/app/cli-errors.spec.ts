import { describe, expect, it } from 'vitest';
import { exitCodeFor, mutableFromCli } from './cli-errors';

describe('exitCodeFor', () => {
  it('returns 1 for query', () => {
    expect(exitCodeFor('query')).toBe(1);
  });

  it('returns 1 for serve', () => {
    expect(exitCodeFor('serve')).toBe(1);
  });

  it('returns 2 for diff', () => {
    expect(exitCodeFor('diff')).toBe(2);
  });

  it('returns 1 for hash by default', () => {
    expect(exitCodeFor('hash')).toBe(1);
  });

  it('returns 2 for hash in compare-with mode', () => {
    expect(exitCodeFor('hash', { hashCompareMode: true })).toBe(2);
  });
});

describe('mutableFromCli', () => {
  it('returns undefined when neither flag is set', () => {
    expect(mutableFromCli({})).toBeUndefined();
  });

  it('--mutable returns true', () => {
    expect(mutableFromCli({ mutable: true })).toBe(true);
  });

  it('--immutable=false returns true', () => {
    expect(mutableFromCli({ immutable: false })).toBe(true);
  });

  it('--immutable=true returns false', () => {
    expect(mutableFromCli({ immutable: true })).toBe(false);
  });

  it('--mutable wins over --immutable', () => {
    expect(mutableFromCli({ mutable: true, immutable: true })).toBe(true);
  });
});
