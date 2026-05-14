import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { safeParseResult, type SafeParseError } from './safe-parse-result';

describe('safeParseResult', () => {
  const Schema = z.object({ a: z.string() }).strict();

  it('returns an ok Result with the parsed data when the schema accepts the input', () => {
    const result = safeParseResult(Schema, { a: 'hi' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ a: 'hi' });
    }
  });

  it('returns an err Result carrying issues when the schema rejects the input', () => {
    const result = safeParseResult(Schema, { a: 42 });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      const e: SafeParseError = result.error;
      expect(e.kind).toBe('zod-validation');
      expect(e.issues.length).toBeGreaterThan(0);
      expect(e.issues[0]).toMatchObject({ path: ['a'] });
      expect(typeof e.issues[0].message).toBe('string');
    }
  });
});
