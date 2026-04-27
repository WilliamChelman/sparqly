import { describe, expect, it } from 'vitest';
import { assertImmutable } from './immutability';

describe('assertImmutable', () => {
  it('allows read queries', () => {
    expect(() => assertImmutable('SELECT')).not.toThrow();
    expect(() => assertImmutable('ASK')).not.toThrow();
    expect(() => assertImmutable('CONSTRUCT')).not.toThrow();
    expect(() => assertImmutable('DESCRIBE')).not.toThrow();
  });

  it('rejects UPDATE by default with a message naming the opt-in flags', () => {
    expect(() => assertImmutable('UPDATE')).toThrow(
      /Mutating queries.*--mutable.*--immutable=false/,
    );
  });

  it('rejects UPDATE when mutable is explicitly false', () => {
    expect(() => assertImmutable('UPDATE', { mutable: false })).toThrow(
      /Mutating queries/,
    );
  });

  it('does not throw the guard error when mutable is true (execution-not-implemented is acceptable)', () => {
    expect(() => assertImmutable('UPDATE', { mutable: true })).toThrow(
      /not yet implemented/i,
    );
    expect(() => assertImmutable('UPDATE', { mutable: true })).not.toThrow(
      /Mutating queries are disabled/,
    );
  });

  it('still allows read queries when mutable is true', () => {
    expect(() => assertImmutable('SELECT', { mutable: true })).not.toThrow();
    expect(() => assertImmutable('ASK', { mutable: true })).not.toThrow();
    expect(() => assertImmutable('CONSTRUCT', { mutable: true })).not.toThrow();
    expect(() => assertImmutable('DESCRIBE', { mutable: true })).not.toThrow();
  });
});
