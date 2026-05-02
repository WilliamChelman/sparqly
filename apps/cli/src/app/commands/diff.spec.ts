import { describe, expect, it } from 'vitest';
import { blockSchemaFromFields, defaultsFromFields } from '../runner/field';
import { diffSpec } from './diff';

describe('diffSpec', () => {
  it('declares two positionals bound to left and right', () => {
    expect(diffSpec.positionals).toEqual([
      { field: 'left', name: 'left' },
      { field: 'right', name: 'right' },
    ]);
  });

  it('rejects unknown --format with the expected enum', () => {
    const schema = blockSchemaFromFields(diffSpec.fields);
    const r = schema.safeParse({ format: 'csv' });
    expect(r.success).toBe(false);
  });

  it('accepts --format=turtle, human, json, rdf-patch', () => {
    const schema = blockSchemaFromFields(diffSpec.fields);
    for (const f of ['turtle', 'human', 'json', 'rdf-patch']) {
      expect(schema.safeParse({ format: f }).success).toBe(true);
    }
  });

  it('declares default format=human and graphMode=preserve', () => {
    expect(defaultsFromFields(diffSpec.fields)).toMatchObject({
      format: 'human',
      graphMode: 'preserve',
      verbose: false,
      quiet: false,
    });
  });

  it('rejects unknown --graph-mode', () => {
    const schema = blockSchemaFromFields(diffSpec.fields);
    expect(schema.safeParse({ graphMode: 'bogus' }).success).toBe(false);
  });

  it('exitCode returns 2 by default for unknown errors', () => {
    expect(diffSpec.exitCode(new Error('boom'))).toBe(2);
  });
});
