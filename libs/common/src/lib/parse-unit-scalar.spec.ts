import { describe, expect, it } from 'vitest';
import { parseUnitScalar } from './parse-unit-scalar';

/**
 * `parseUnitScalar` is the shared parser skeleton behind `parseHumanByteSize`
 * and `parseHumanDuration`: it reads `<magnitude><unit>` against a caller-
 * supplied multiplier table, scaling the magnitude by the matched multiplier.
 * It is unit-agnostic — every byte/duration-specific rule lives in the table —
 * and keeps the same `undefined`-on-garbage / non-positive contract its callers
 * have always exposed.
 */
describe('parseUnitScalar', () => {
  const multipliers: Record<string, number> = { '': 1, k: 1000, m: 1_000_000 };

  it('scales a magnitude by its matched (case-insensitive) unit', () => {
    expect(parseUnitScalar('2k', multipliers)).toBe(2000);
    expect(parseUnitScalar('3M', multipliers)).toBe(3_000_000);
  });

  it('reads a bare number as the empty-unit multiplier', () => {
    expect(parseUnitScalar('42', multipliers)).toBe(42);
  });

  it('accepts a decimal magnitude and surrounding whitespace, rounding the result', () => {
    expect(parseUnitScalar('1.5k', multipliers)).toBe(1500);
    expect(parseUnitScalar('  2 k ', multipliers)).toBe(2000);
  });

  it('returns undefined for an unknown unit, garbage, empty, or non-positive input', () => {
    expect(parseUnitScalar('2t', multipliers)).toBeUndefined();
    expect(parseUnitScalar('abc', multipliers)).toBeUndefined();
    expect(parseUnitScalar('', multipliers)).toBeUndefined();
    expect(parseUnitScalar('0', multipliers)).toBeUndefined();
    expect(parseUnitScalar('-5k', multipliers)).toBeUndefined();
  });
});
