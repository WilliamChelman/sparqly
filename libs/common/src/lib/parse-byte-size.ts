import { parseUnitScalar } from './parse-unit-scalar';

/**
 * Parses a human byte size — `256MB`, `1.5gb`, `512`, `32KiB` — into a raw byte
 * count, or `undefined` when the input is unparseable or non-positive.
 *
 * Units are **1024-based** (`KB`=`KiB`=1024, `MB`=`MiB`=1024², `GB`=`GiB`=1024³),
 * matching sparqly's other byte budgets — so `256MB` resolves to exactly the
 * Query cache's default global budget (`256 * 1024 * 1024`). A bare number, or a
 * `B`/no-suffix value, is taken as raw bytes.
 */
export function parseHumanByteSize(input: string): number | undefined {
  return parseUnitScalar(input, UNIT_MULTIPLIERS);
}

/**
 * Validates one configured byte budget — a raw count or a human string — to a
 * positive byte count, or `undefined` when it is neither (a non-positive /
 * fractional number, or an unparseable string). The shared core behind the
 * project config's `byteSizeSchema` (zod) and a source's per-source `maxBytes`
 * (`resolveMaxBytes`): both reject the same shapes, then each layers its own
 * error reporting and its own `null`-as-unbounded contract on top. Null is *not*
 * handled here — it is a field-level concern, valid only where an unbounded
 * budget is meaningful (a global/per-source cap, never a per-entry ceiling).
 */
export function resolvePositiveByteSize(
  value: number | string,
): number | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }
  return parseHumanByteSize(value);
}

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

const UNIT_MULTIPLIERS: Record<string, number> = {
  '': 1,
  b: 1,
  k: KIB,
  kb: KIB,
  kib: KIB,
  m: MIB,
  mb: MIB,
  mib: MIB,
  g: GIB,
  gb: GIB,
  gib: GIB,
};
