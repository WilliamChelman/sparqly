import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { blockSchemaFromFields } from '../runner/field';
import { formatSpec } from './format';

describe('formatSpec', () => {
  it('declares one positional bound to sources', () => {
    expect(formatSpec.positionals).toEqual([
      { field: 'sources', name: 'glob' },
    ]);
  });

  it('rejects --write combined with --check via spec.refine', () => {
    const baseSchema = blockSchemaFromFields(formatSpec.fields);
    if (!formatSpec.refine) throw new Error('expected refine');
    const schema = formatSpec.refine(baseSchema);
    const result = schema.safeParse({ write: true, check: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = (result as z.ZodSafeParseError<unknown>).error.issues.map(
        (i) => i.message,
      );
      expect(messages).toContain('--write and --check are mutually exclusive');
    }
  });

  it('rejects --out combined with --write via spec.refine', () => {
    const baseSchema = blockSchemaFromFields(formatSpec.fields);
    if (!formatSpec.refine) throw new Error('expected refine');
    const schema = formatSpec.refine(baseSchema);
    const result = schema.safeParse({ out: 'x.ttl', write: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = (result as z.ZodSafeParseError<unknown>).error.issues.map(
        (i) => i.message,
      );
      expect(messages).toContain(
        '--out cannot be combined with --write or --check',
      );
    }
  });

  it('accepts --write alone or --check alone', () => {
    const baseSchema = blockSchemaFromFields(formatSpec.fields);
    if (!formatSpec.refine) throw new Error('expected refine');
    const schema = formatSpec.refine(baseSchema);
    expect(schema.safeParse({ write: true }).success).toBe(true);
    expect(schema.safeParse({ check: true }).success).toBe(true);
  });

  it('exposes a --prefix flag (string[]) field', () => {
    const prefix = formatSpec.fields.find((f) => f.key === 'prefix');
    expect(prefix).toBeDefined();
    expect(prefix?.flags?.[0].spec).toBe('--prefix <name=iri>');
  });

  it('exitCode returns 2 in --check mode and 1 otherwise', () => {
    expect(
      formatSpec.exitCode(new Error('x'), {
        rawConfig: { check: true },
      }),
    ).toBe(2);
    expect(formatSpec.exitCode(new Error('x'))).toBe(1);
  });
});
