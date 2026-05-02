import { describe, expect, it } from 'vitest';
import { blockSchemaFromFields, defaultsFromFields } from '../runner/field';
import { hashSpec, HashCompareError, HashMismatchSignal } from './hash';

describe('hashSpec', () => {
  it('rejects unknown --graph-mode', () => {
    const schema = blockSchemaFromFields(hashSpec.fields);
    const r = schema.safeParse({ graphMode: 'bogus' });
    expect(r.success).toBe(false);
  });

  it('accepts --sources as a string or non-empty string array', () => {
    const schema = blockSchemaFromFields(hashSpec.fields);
    expect(schema.safeParse({ sources: 'a/*.ttl' }).success).toBe(true);
    expect(schema.safeParse({ sources: ['a/*.ttl', 'b/*.ttl'] }).success).toBe(
      true,
    );
    expect(schema.safeParse({ sources: [] }).success).toBe(false);
  });

  it('coerces "true"/"1"/"false"/"0" strings to booleans for json/verbose/quiet', () => {
    const schema = blockSchemaFromFields(hashSpec.fields);
    expect(
      (schema.parse({ json: 'true' }) as { json: boolean }).json,
    ).toBe(true);
    expect(
      (schema.parse({ verbose: '1' }) as { verbose: boolean }).verbose,
    ).toBe(true);
    expect(
      (schema.parse({ quiet: 'false' }) as { quiet: boolean }).quiet,
    ).toBe(false);
  });

  it('declares default graphMode="preserve" and json=false', () => {
    expect(defaultsFromFields(hashSpec.fields)).toMatchObject({
      graphMode: 'preserve',
      json: false,
      verbose: false,
      quiet: false,
    });
  });

  it('exitCode returns 1 for HashMismatchSignal, 2 in compare mode, 1 otherwise', () => {
    expect(hashSpec.exitCode(new HashMismatchSignal('x'))).toBe(1);
    expect(
      hashSpec.exitCode(new HashCompareError('x'), {
        rawConfig: { compareWith: 'b.ttl' },
      }),
    ).toBe(2);
    expect(
      hashSpec.exitCode(new Error('boom'), {
        rawConfig: { compareWith: 'b.ttl' },
      }),
    ).toBe(2);
    expect(hashSpec.exitCode(new Error('boom'))).toBe(1);
  });

  it('declares one positional bound to the sources field', () => {
    expect(hashSpec.positionals).toEqual([{ field: 'sources', name: 'glob' }]);
  });
});
