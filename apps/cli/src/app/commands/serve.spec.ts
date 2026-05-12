import { describe, expect, it } from 'vitest';
import { blockSchemaFromFields, defaultsFromFields } from '../runner/fields/field';
import { serveSpec } from './serve';

describe('serveSpec — single-target shape', () => {
  it('binds a single positional to the `source` field', () => {
    expect(serveSpec.positionals).toEqual([
      { field: 'source', name: 'glob' },
    ]);
  });

  it('exposes a `--source` flag (singular) and no `--sources`', () => {
    const sourceFlags =
      serveSpec.fields.find((f) => f.key === 'source')?.flags ?? [];
    expect(sourceFlags.length).toBeGreaterThan(0);
    for (const f of sourceFlags) {
      expect(f.spec).toMatch(/--source\b/);
      expect(f.spec).not.toMatch(/--sources\b/);
    }
    expect(serveSpec.fields.find((f) => f.key === 'sources')?.flags ?? []).toEqual([]);
  });

  it('declares defaults for port=3000, watch=false, watchDebounce=250, mutable=false and no graphMode default', () => {
    const defaults = defaultsFromFields(serveSpec.fields);
    expect(defaults).toMatchObject({
      port: 3000,
      watch: false,
      watchDebounce: 250,
      mutable: false,
      verbose: false,
      quiet: false,
    });
    expect('graphMode' in defaults).toBe(false);
  });

  it('coerces "4000" string into port number', () => {
    const schema = blockSchemaFromFields(serveSpec.fields);
    const r = schema.parse({ port: '4000' }) as { port: number };
    expect(r.port).toBe(4000);
  });

  it('does not expose a top-level graphMode field (graph-name semantics live on transforms)', () => {
    expect(serveSpec.fields.find((f) => f.key === 'graphMode')).toBeUndefined();
    const flagSpecs = serveSpec.fields.flatMap((f) => f.flags ?? []).map(
      (f) => f.spec,
    );
    for (const s of flagSpecs) expect(s).not.toMatch(/--graph-mode/);
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

  it('env mirrors per ADR-0010: SPARQLY_PORT only on port; no env on watch/watchDebounce/watchPoll/mutable', () => {
    const envOf = (key: string): readonly string[] => {
      const f = serveSpec.fields.find((x) => x.key === key);
      if (!f?.env) return [];
      return typeof f.env === 'string' ? [f.env] : f.env;
    };
    expect(envOf('port')).toEqual(['SPARQLY_PORT']);
    expect(envOf('watch')).toEqual([]);
    expect(envOf('watchDebounce')).toEqual([]);
    expect(envOf('watchPoll')).toEqual([]);
    expect(envOf('mutable')).toEqual([]);
  });
});

describe('serveSpec — array `--source` rejection', () => {
  it('rejects an array `--source` value with the ADR-0005-linked wording', () => {
    const schema = blockSchemaFromFields(serveSpec.fields);
    const result = schema.safeParse({ source: ['a/*.ttl', 'b/*.ttl'] });
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = result.error.issues.map((i) => i.message).join('\n');
    expect(message).toMatch(/single/i);
    expect(message).toMatch(/SERVICE/);
    expect(message).toMatch(/empty/);
    expect(message).toMatch(/ADR-0005|0005-single-target-source/);
  });
});
