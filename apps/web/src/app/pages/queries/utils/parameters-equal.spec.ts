import { describe, expect, it } from 'vitest';
import type { ParameterDeclaration } from 'common';
import { parametersEqual } from './parameters-equal';

const cls: ParameterDeclaration = {
  name: 'cls',
  type: 'iri',
  cardinality: '1..1',
};
const country: ParameterDeclaration = {
  name: 'country',
  type: 'string',
  cardinality: '1..1',
};

describe('parametersEqual', () => {
  it('returns true for empty lists', () => {
    expect(parametersEqual([], [])).toBe(true);
  });

  it('returns true for the same declarations in the same order', () => {
    expect(parametersEqual([cls], [{ ...cls }])).toBe(true);
  });

  it('returns false when order differs', () => {
    expect(parametersEqual([cls, country], [country, cls])).toBe(false);
  });

  it('returns false when a field changes', () => {
    expect(
      parametersEqual([cls], [{ ...cls, cardinality: '0..n' as const }]),
    ).toBe(false);
  });
});
