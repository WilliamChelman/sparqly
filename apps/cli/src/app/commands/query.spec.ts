import { describe, expect, it } from 'vitest';
import { blockSchemaFromFields, defaultsFromFields } from '../runner/field';
import { querySpec } from './query';

describe('querySpec', () => {
  it('declares one positional bound to the sources field', () => {
    expect(querySpec.positionals).toEqual([
      { field: 'sources', name: 'glob' },
    ]);
  });

  it('declares default graphStrategy=default and mutable=false', () => {
    expect(defaultsFromFields(querySpec.fields)).toMatchObject({
      graphStrategy: 'default',
      mutable: false,
      verbose: false,
      quiet: false,
    });
  });

  it('rejects unknown --format with the SUPPORTED_FORMATS enum (json, turtle)', () => {
    const schema = blockSchemaFromFields(querySpec.fields);
    expect(schema.safeParse({ format: 'csv' }).success).toBe(false);
    expect(schema.safeParse({ format: 'json' }).success).toBe(true);
    expect(schema.safeParse({ format: 'turtle' }).success).toBe(true);
  });

  it('rejects unknown --graph-strategy', () => {
    const schema = blockSchemaFromFields(querySpec.fields);
    expect(schema.safeParse({ graphStrategy: 'bogus' }).success).toBe(false);
  });

  it('exposes both --mutable and --immutable flags writing to the mutable field', () => {
    const mutable = querySpec.fields.find((f) => f.key === 'mutable');
    expect(mutable).toBeDefined();
    const flagSpecs = (mutable?.flags ?? []).map((f) => f.spec);
    expect(flagSpecs).toContain('--mutable');
    expect(flagSpecs).toContain('--immutable [value]');
    for (const flag of mutable?.flags ?? []) {
      expect(flag.attributeName).toBe('mutable');
    }
  });

  it('exitCode returns 1 by default', () => {
    expect(querySpec.exitCode(new Error('boom'))).toBe(1);
  });
});
