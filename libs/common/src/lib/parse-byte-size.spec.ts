import { describe, expect, it } from 'vitest';
import { parseHumanByteSize, resolvePositiveByteSize } from './parse-byte-size';

/**
 * `parseHumanByteSize` turns a human byte size (`256MB`, `1.5gb`, `512`) into a
 * raw byte count. Units are 1024-based to match sparqly's existing budgets
 * (`256MB` === `256 * 1024 * 1024`, the cache's default global budget).
 */
describe('parseHumanByteSize', () => {
  it('reads a bare number as raw bytes', () => {
    expect(parseHumanByteSize('1024')).toBe(1024);
  });

  it('reads 1024-based unit suffixes, case-insensitively', () => {
    expect(parseHumanByteSize('1KB')).toBe(1024);
    expect(parseHumanByteSize('256MB')).toBe(256 * 1024 * 1024);
    expect(parseHumanByteSize('32mb')).toBe(32 * 1024 * 1024);
    expect(parseHumanByteSize('2GB')).toBe(2 * 1024 * 1024 * 1024);
  });

  it('treats the IEC and bare-letter spellings as the same 1024 base', () => {
    expect(parseHumanByteSize('1KiB')).toBe(1024);
    expect(parseHumanByteSize('1K')).toBe(1024);
    expect(parseHumanByteSize('1MiB')).toBe(1024 * 1024);
    expect(parseHumanByteSize('512B')).toBe(512);
  });

  it('accepts a decimal magnitude and surrounding whitespace', () => {
    expect(parseHumanByteSize('1.5MB')).toBe(Math.round(1.5 * 1024 * 1024));
    expect(parseHumanByteSize('  256 MB ')).toBe(256 * 1024 * 1024);
  });

  it('returns undefined for an unparseable or non-positive size', () => {
    expect(parseHumanByteSize('abc')).toBeUndefined();
    expect(parseHumanByteSize('10TB')).toBeUndefined(); // unknown unit
    expect(parseHumanByteSize('0')).toBeUndefined();
    expect(parseHumanByteSize('-5MB')).toBeUndefined();
    expect(parseHumanByteSize('')).toBeUndefined();
  });
});

/**
 * `resolvePositiveByteSize` is the shared validation core behind the project
 * config's `byteSizeSchema` (zod) and a source's per-source `maxBytes`
 * (`resolveMaxBytes`): a raw count must be a positive integer, a string goes
 * through `parseHumanByteSize`, and `null`-as-unbounded is *not* its concern —
 * that is a field-level contract layered on by the callers.
 */
describe('resolvePositiveByteSize', () => {
  it('passes a positive integer count through unchanged', () => {
    expect(resolvePositiveByteSize(1024)).toBe(1024);
  });

  it('resolves a human string via the 1024-based parser', () => {
    expect(resolvePositiveByteSize('256MB')).toBe(256 * 1024 * 1024);
  });

  it('returns undefined for a fractional, zero, or negative raw count', () => {
    expect(resolvePositiveByteSize(1.5)).toBeUndefined();
    expect(resolvePositiveByteSize(0)).toBeUndefined();
    expect(resolvePositiveByteSize(-5)).toBeUndefined();
  });

  it('returns undefined for an unparseable string', () => {
    expect(resolvePositiveByteSize('huge')).toBeUndefined();
  });
});
