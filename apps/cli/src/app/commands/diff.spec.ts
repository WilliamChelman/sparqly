import { describe, expect, it } from 'vitest';
import { blockSchemaFromFields, defaultsFromFields } from '../runner/field';
import { diffSpec, resolveDiffSide } from './diff';

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

  it('accepts --format=turtle, human, json, rdf-patch, html', () => {
    const schema = blockSchemaFromFields(diffSpec.fields);
    for (const f of ['turtle', 'human', 'json', 'rdf-patch', 'html']) {
      expect(schema.safeParse({ format: f }).success).toBe(true);
    }
  });

  it('rejects --context above 100', () => {
    const schema = blockSchemaFromFields(diffSpec.fields);
    expect(schema.safeParse({ context: 101 }).success).toBe(false);
    expect(schema.safeParse({ context: 100 }).success).toBe(true);
    expect(schema.safeParse({ context: 0 }).success).toBe(true);
  });

  it('rejects negative or non-integer --context', () => {
    const schema = blockSchemaFromFields(diffSpec.fields);
    expect(schema.safeParse({ context: -1 }).success).toBe(false);
    expect(schema.safeParse({ context: 1.5 }).success).toBe(false);
  });

  it('rejects --context against any non-html format (loud-error, no silent ignore)', () => {
    const schema = blockSchemaFromFields(diffSpec.fields);
    // Refined schema lives on diffSpec.refine; build a refined version like the runner does.
    const refined = diffSpec.refine
      ? diffSpec.refine(schema as never)
      : schema;
    for (const f of ['human', 'json', 'rdf-patch', 'turtle']) {
      const r = refined.safeParse({ format: f, context: 5 });
      expect(r.success).toBe(false);
      if (!r.success) {
        const msg = r.error.issues.map((i) => i.message).join('\n');
        expect(msg).toMatch(/--context/);
        expect(msg).toMatch(/html/);
      }
    }
    expect(refined.safeParse({ format: 'html', context: 5 }).success).toBe(
      true,
    );
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

describe('diffSpec — single-target shape', () => {
  for (const side of ['left', 'right'] as const) {
    it(`exposes a --${side} flag (singular) that accepts one source`, () => {
      const flags =
        diffSpec.fields.find((f) => f.key === side)?.flags ?? [];
      expect(flags.length).toBeGreaterThan(0);
      for (const f of flags) {
        expect(f.spec).toMatch(new RegExp(`--${side}\\b`));
      }
    });
  }

  for (const side of ['left', 'right'] as const) {
    it(`rejects an array --${side} value with the new ADR-0005-linked wording`, () => {
      const schema = blockSchemaFromFields(diffSpec.fields);
      const result = schema.safeParse({ [side]: ['a/*.ttl', 'b/*.ttl'] });
      expect(result.success).toBe(false);
      if (result.success) return;
      const message = result.error.issues.map((i) => i.message).join('\n');
      expect(message).toMatch(/single/i);
      expect(message).toMatch(/SERVICE/);
      expect(message).toMatch(/empty/);
      expect(message).toMatch(/ADR-0005|0005-single-target-source/);
    });
  }
});

describe('resolveDiffSide — selection precedence', () => {
  it('auto-picks the sole registry entry when no positional/flag is given', () => {
    const target = resolveDiffSide(
      { sources: [{ id: 'files', glob: 'data/*.ttl' }] },
      'left',
    );
    expect(target).toMatchObject({ kind: 'glob', id: 'files' });
  });

  it('falls back to the `default: true` entry when no positional/flag is given', () => {
    const target = resolveDiffSide(
      {
        sources: [
          { id: 'files', glob: 'data/*.ttl' },
          { id: 'live', endpoint: 'https://example.com/sparql', default: true },
        ],
      },
      'right',
    );
    expect(target).toMatchObject({ kind: 'endpoint', id: 'live' });
  });

  it('errors with the available `@ids` when the registry is ambiguous and no flag is given', () => {
    expect(() =>
      resolveDiffSide(
        {
          sources: [
            { id: 'files', glob: 'data/*.ttl' },
            { id: 'live', endpoint: 'https://example.com/sparql' },
          ],
        },
        'left',
      ),
    ).toThrow(/@files.*@live/s);
  });

  it('inline positional wins over a `default: true` entry', () => {
    const target = resolveDiffSide(
      {
        sources: [
          { id: 'live', endpoint: 'https://example.com/sparql', default: true },
        ],
        left: 'adhoc/*.ttl',
      },
      'left',
    );
    expect(target).toEqual({ kind: 'glob', glob: 'adhoc/*.ttl' });
  });

  it('explicit `@id` ref wins over a `default: true` entry', () => {
    const target = resolveDiffSide(
      {
        sources: [
          { id: 'files', glob: 'data/*.ttl' },
          { id: 'live', endpoint: 'https://example.com/sparql', default: true },
        ],
        right: '@files',
      },
      'right',
    );
    expect(target).toMatchObject({ kind: 'glob', id: 'files' });
  });

  it('does not require any `sources` registry when an inline source is provided', () => {
    const target = resolveDiffSide({ left: 'adhoc/*.ttl' }, 'left');
    expect(target).toEqual({ kind: 'glob', glob: 'adhoc/*.ttl' });
  });
});
