/**
 * Parses a human time span — `30s`, `30min`, `1.5h`, `500ms`, `1d` — into a
 * millisecond count, or `undefined` when the input is unparseable or
 * non-positive.
 *
 * Mirrors {@link parseHumanByteSize}: a bare number (no unit) is taken as raw
 * milliseconds — the canonical internal unit — so the parser round-trips its own
 * output. Recognized units: `ms`, `s`/`sec`, `m`/`min`, `h`/`hr`, `d`/`day`
 * (and their plurals), case-insensitive.
 */
export function parseHumanDuration(input: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(input);
  if (match === null) return undefined;
  const multiplier = UNIT_MULTIPLIERS[match[2].toLowerCase()];
  if (multiplier === undefined) return undefined;
  const ms = Number(match[1]) * multiplier;
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.round(ms);
}

const SECOND = 1000;
const MINUTE = SECOND * 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;

const UNIT_MULTIPLIERS: Record<string, number> = {
  '': 1,
  ms: 1,
  msec: 1,
  millis: 1,
  s: SECOND,
  sec: SECOND,
  secs: SECOND,
  second: SECOND,
  seconds: SECOND,
  m: MINUTE,
  min: MINUTE,
  mins: MINUTE,
  minute: MINUTE,
  minutes: MINUTE,
  h: HOUR,
  hr: HOUR,
  hrs: HOUR,
  hour: HOUR,
  hours: HOUR,
  d: DAY,
  day: DAY,
  days: DAY,
};
