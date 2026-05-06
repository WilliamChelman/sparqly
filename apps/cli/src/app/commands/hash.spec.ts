import { describe, expect, it } from 'vitest';
import { blockSchemaFromFields, defaultsFromFields } from '../runner/field';
import {
  hashSpec,
  HashCompareError,
  HashMismatchSignal,
  resolveHashTarget,
} from './hash';

describe('hashSpec — single-target shape', () => {
  it('binds a single positional to the `source` field', () => {
    expect(hashSpec.positionals).toEqual([{ field: 'source', name: 'glob' }]);
  });

  it('exposes a `--source` flag (singular) and no `--sources`', () => {
    const sourceFlags =
      hashSpec.fields.find((f) => f.key === 'source')?.flags ?? [];
    expect(sourceFlags.length).toBeGreaterThan(0);
    for (const f of sourceFlags) {
      expect(f.spec).toMatch(/--source\b/);
      expect(f.spec).not.toMatch(/--sources\b/);
    }
    expect(hashSpec.fields.find((f) => f.key === 'sources')?.flags ?? []).toEqual(
      [],
    );
  });

  it('does not expose a top-level graphMode field (graph-name semantics live on transforms)', () => {
    expect(hashSpec.fields.find((f) => f.key === 'graphMode')).toBeUndefined();
    const flagSpecs = hashSpec.fields.flatMap((f) => f.flags ?? []).map(
      (f) => f.spec,
    );
    for (const s of flagSpecs) expect(s).not.toMatch(/--graph-mode/);
  });

  it('coerces "true"/"1"/"false"/"0" strings to booleans for json/verbose/quiet', () => {
    const schema = blockSchemaFromFields(hashSpec.fields);
    expect((schema.parse({ json: 'true' }) as { json: boolean }).json).toBe(true);
    expect((schema.parse({ verbose: '1' }) as { verbose: boolean }).verbose).toBe(
      true,
    );
    expect((schema.parse({ quiet: 'false' }) as { quiet: boolean }).quiet).toBe(
      false,
    );
  });

  it('declares defaults for json/verbose/quiet and no graphMode default', () => {
    const defaults = defaultsFromFields(hashSpec.fields);
    expect(defaults).toMatchObject({
      json: false,
      verbose: false,
      quiet: false,
    });
    expect('graphMode' in defaults).toBe(false);
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
});

describe('hashSpec — array `--source` rejection', () => {
  it('rejects an array `--source` value with the new ADR-0005-linked wording', () => {
    const schema = blockSchemaFromFields(hashSpec.fields);
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

describe('resolveHashTarget — selection precedence', () => {
  it('auto-picks the sole registry entry when no positional/--source is given', () => {
    const target = resolveHashTarget({
      sources: [{ id: 'files', glob: 'data/*.ttl' }],
    });
    expect(target).toMatchObject({ kind: 'glob', id: 'files' });
  });

  it('falls back to the `default: true` entry when no positional/--source is given', () => {
    const target = resolveHashTarget({
      sources: [
        { id: 'files', glob: 'data/*.ttl' },
        { id: 'live', endpoint: 'https://example.com/sparql', default: true },
      ],
    });
    expect(target).toMatchObject({ kind: 'endpoint', id: 'live' });
  });

  it('errors with the available `@ids` when the registry is ambiguous and no --source is given', () => {
    expect(() =>
      resolveHashTarget({
        sources: [
          { id: 'files', glob: 'data/*.ttl' },
          { id: 'live', endpoint: 'https://example.com/sparql' },
        ],
      }),
    ).toThrow(/@files.*@live/s);
  });

  it('inline positional wins over a `default: true` entry', () => {
    const target = resolveHashTarget({
      sources: [
        { id: 'live', endpoint: 'https://example.com/sparql', default: true },
      ],
      source: 'adhoc/*.ttl',
    });
    expect(target).toEqual({ kind: 'glob', glob: 'adhoc/*.ttl' });
  });

  it('explicit `@id` ref wins over a `default: true` entry', () => {
    const target = resolveHashTarget({
      sources: [
        { id: 'files', glob: 'data/*.ttl' },
        { id: 'live', endpoint: 'https://example.com/sparql', default: true },
      ],
      source: '@files',
    });
    expect(target).toMatchObject({ kind: 'glob', id: 'files' });
  });

  it('does not require any `sources` registry when an inline source is provided', () => {
    const target = resolveHashTarget({ source: 'adhoc/*.ttl' });
    expect(target).toEqual({ kind: 'glob', glob: 'adhoc/*.ttl' });
  });
});
