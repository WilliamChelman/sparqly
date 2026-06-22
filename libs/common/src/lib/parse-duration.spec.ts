import { describe, expect, it } from 'vitest';
import { parseHumanDuration } from './parse-duration';

/**
 * `parseHumanDuration` turns a human time span (`30s`, `30min`, `1h`) into a
 * millisecond count, mirroring `parseHumanByteSize` — same shape, same
 * `undefined`-on-garbage contract. It backs the Query cache's per-source `ttl`
 * (ADR-0054, #416).
 */
describe('parseHumanDuration', () => {
  it('parses seconds', () => {
    expect(parseHumanDuration('30s')).toBe(30 * 1000);
  });

  it('parses minutes (min)', () => {
    expect(parseHumanDuration('30min')).toBe(30 * 60 * 1000);
  });

  it('parses hours', () => {
    expect(parseHumanDuration('1h')).toBe(60 * 60 * 1000);
  });

  it('returns undefined for an unparseable value', () => {
    expect(parseHumanDuration('soon')).toBeUndefined();
  });
});
