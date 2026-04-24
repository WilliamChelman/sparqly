import { describe, expect, it } from 'vitest';
import { assertImmutable } from './immutability';

describe('assertImmutable', () => {
  it('allows read queries', () => {
    expect(() => assertImmutable('SELECT')).not.toThrow();
    expect(() => assertImmutable('ASK')).not.toThrow();
    expect(() => assertImmutable('CONSTRUCT')).not.toThrow();
    expect(() => assertImmutable('DESCRIBE')).not.toThrow();
  });

  it('rejects UPDATE', () => {
    expect(() => assertImmutable('UPDATE')).toThrow(/Mutating queries/);
  });
});
