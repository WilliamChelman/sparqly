import { describe, expect, it } from 'vitest';
import { blockSchemaFromFields, defaultsFromFields } from '../runner/field';
import { serveSpec } from './serve';

describe('serveSpec', () => {
  it('declares one positional bound to the sources field', () => {
    expect(serveSpec.positionals).toEqual([
      { field: 'sources', name: 'glob' },
    ]);
  });

  it('declares defaults for port=3000, watch=false, watchDebounce=250, mutable=false', () => {
    expect(defaultsFromFields(serveSpec.fields)).toMatchObject({
      port: 3000,
      watch: false,
      watchDebounce: 250,
      mutable: false,
      graphStrategy: 'default',
      verbose: false,
      quiet: false,
    });
  });

  it('coerces "4000" string into port number', () => {
    const schema = blockSchemaFromFields(serveSpec.fields);
    const r = schema.parse({ port: '4000' }) as { port: number };
    expect(r.port).toBe(4000);
  });

  it('rejects unknown --graph-strategy', () => {
    const schema = blockSchemaFromFields(serveSpec.fields);
    expect(schema.safeParse({ graphStrategy: 'bogus' }).success).toBe(false);
  });

  it('exposes both --mutable and --immutable writing to the mutable field', () => {
    const mutable = serveSpec.fields.find((f) => f.key === 'mutable');
    expect(mutable).toBeDefined();
    for (const flag of mutable?.flags ?? []) {
      expect(flag.attributeName).toBe('mutable');
    }
  });

  it('exitCode returns 1 by default', () => {
    expect(serveSpec.exitCode(new Error('boom'))).toBe(1);
  });
});
