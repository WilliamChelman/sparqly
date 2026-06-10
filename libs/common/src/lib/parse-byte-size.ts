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
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(input);
  if (match === null) return undefined;
  const multiplier = UNIT_MULTIPLIERS[match[2].toLowerCase()];
  if (multiplier === undefined) return undefined;
  const bytes = Number(match[1]) * multiplier;
  if (!Number.isFinite(bytes) || bytes <= 0) return undefined;
  return Math.round(bytes);
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
