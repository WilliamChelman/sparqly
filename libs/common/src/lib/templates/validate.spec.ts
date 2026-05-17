import { describe, expect, it } from 'vitest';
import type { ParameterDeclaration } from './parameter-declaration';
import { validate } from './validate';

function decl(p: ParameterDeclaration): ParameterDeclaration {
  return p;
}

describe('validate', () => {
  it('accepts a well-typed iri / 1..1 binding', () => {
    const result = validate(
      [decl({ name: 'c', type: 'iri', cardinality: '1..1' })],
      { c: 'http://example.org/CA' },
    );
    expect(result.isOk()).toBe(true);
  });

  it('rejects a non-string value for an iri parameter (type mismatch)', () => {
    const result = validate(
      [decl({ name: 'c', type: 'iri', cardinality: '1..1' })],
      { c: 42 },
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('type-mismatch');
      expect(result.error.name).toBe('c');
    }
  });

  it('rejects a missing 1..1 binding (cardinality lower-bound)', () => {
    const result = validate(
      [decl({ name: 'c', type: 'iri', cardinality: '1..1' })],
      {},
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('cardinality-violation');
      expect(result.error.name).toBe('c');
    }
  });

  it('rejects an empty list for a 1..n binding', () => {
    const result = validate(
      [decl({ name: 'c', type: 'iri', cardinality: '1..n' })],
      { c: [] },
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('cardinality-violation');
    }
  });
});
