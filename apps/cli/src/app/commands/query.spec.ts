import { describe, expect, it } from 'vitest';
import { blockSchemaFromFields, defaultsFromFields } from '../runner/field';
import { querySpec, resolveQueryTarget } from './query';

describe('querySpec — single-target shape', () => {
  it('binds a single positional to the `source` field', () => {
    expect(querySpec.positionals).toEqual([
      { field: 'source', name: 'glob' },
    ]);
  });

  it('exposes a `--source` flag (singular) and no `--sources`', () => {
    const sourceFlags =
      querySpec.fields.find((f) => f.key === 'source')?.flags ?? [];
    expect(sourceFlags.length).toBeGreaterThan(0);
    for (const f of sourceFlags) {
      expect(f.spec).toMatch(/--source\b/);
      expect(f.spec).not.toMatch(/--sources\b/);
    }
    expect(querySpec.fields.find((f) => f.key === 'sources')?.flags ?? []).toEqual([]);
  });

  it('declares default mutable=false and no graphMode default', () => {
    const defaults = defaultsFromFields(querySpec.fields);
    expect(defaults).toMatchObject({
      mutable: false,
      verbose: false,
      quiet: false,
    });
    expect('graphMode' in defaults).toBe(false);
  });

  it('rejects unknown --format with the SUPPORTED_FORMATS enum (json, turtle)', () => {
    const schema = blockSchemaFromFields(querySpec.fields);
    expect(schema.safeParse({ format: 'csv' }).success).toBe(false);
    expect(schema.safeParse({ format: 'json' }).success).toBe(true);
    expect(schema.safeParse({ format: 'turtle' }).success).toBe(true);
  });

  it('does not expose a top-level graphMode field (graph-name semantics live on transforms)', () => {
    expect(querySpec.fields.find((f) => f.key === 'graphMode')).toBeUndefined();
    const flagSpecs = querySpec.fields.flatMap((f) => f.flags ?? []).map(
      (f) => f.spec,
    );
    for (const s of flagSpecs) expect(s).not.toMatch(/--graph-mode/);
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

describe('querySpec — array `--source` rejection', () => {
  it('rejects an array `--source` value with the new ADR-0005-linked wording', () => {
    const schema = blockSchemaFromFields(querySpec.fields);
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

describe('resolveQueryTarget — selection precedence', () => {
  it('auto-picks the sole registry entry when no positional/--source is given', () => {
    const target = resolveQueryTarget({
      sources: [{ id: 'files', glob: 'data/*.ttl' }],
    });
    expect(target).toMatchObject({ kind: 'glob', id: 'files' });
  });

  it('falls back to the `default: true` entry when no positional/--source is given', () => {
    const target = resolveQueryTarget({
      sources: [
        { id: 'files', glob: 'data/*.ttl' },
        { id: 'live', endpoint: 'https://example.com/sparql', default: true },
      ],
    });
    expect(target).toMatchObject({ kind: 'endpoint', id: 'live' });
  });

  it('errors with the available `@ids` when the registry is ambiguous and no --source is given', () => {
    expect(() =>
      resolveQueryTarget({
        sources: [
          { id: 'files', glob: 'data/*.ttl' },
          { id: 'live', endpoint: 'https://example.com/sparql' },
        ],
      }),
    ).toThrow(/@files.*@live/s);
  });

  it('inline positional wins over a `default: true` entry', () => {
    const target = resolveQueryTarget({
      sources: [
        { id: 'live', endpoint: 'https://example.com/sparql', default: true },
      ],
      source: 'adhoc/*.ttl',
    });
    expect(target).toEqual({ kind: 'glob', glob: 'adhoc/*.ttl' });
  });

  it('explicit `@id` ref wins over a `default: true` entry', () => {
    const target = resolveQueryTarget({
      sources: [
        { id: 'files', glob: 'data/*.ttl' },
        { id: 'live', endpoint: 'https://example.com/sparql', default: true },
      ],
      source: '@files',
    });
    expect(target).toMatchObject({ kind: 'glob', id: 'files' });
  });

  it('does not require any `sources` registry when an inline source is provided', () => {
    const target = resolveQueryTarget({ source: 'adhoc/*.ttl' });
    expect(target).toEqual({ kind: 'glob', glob: 'adhoc/*.ttl' });
  });
});
