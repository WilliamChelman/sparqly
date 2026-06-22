/**
 * Parses a `<magnitude><unit>` human scalar — `30min`, `256MB`, `512` — into a
 * number, by scaling the magnitude by the multiplier its unit maps to in the
 * caller-supplied table, or `undefined` when the input is unparseable, carries
 * an unknown unit, or resolves to a non-positive / non-finite value.
 *
 * The shared skeleton behind {@link parseHumanByteSize} and
 * {@link parseHumanDuration}: every unit-specific rule (which suffixes exist,
 * what `''` means, the base) lives in `multipliers`, so a caller picks the
 * domain by passing its own table. A bare number matches the `''` entry — the
 * canonical raw unit — so a parser round-trips its own output. Matching is
 * case-insensitive and tolerates surrounding whitespace; a decimal magnitude is
 * rounded after scaling.
 */
export function parseUnitScalar(
  input: string,
  multipliers: Record<string, number>,
): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(input);
  if (match === null) return undefined;
  const multiplier = multipliers[match[2].toLowerCase()];
  if (multiplier === undefined) return undefined;
  const value = Number(match[1]) * multiplier;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value);
}
