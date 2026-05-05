import { describe, expect, it } from 'vitest';
import { blockSchemaFromFields, defaultsFromFields } from '../runner/field';
import {
  collectSnippetKeysForDiff,
  diffSpec,
  resolveDiffSide,
  withAutoSourceAnnotation,
} from './diff';

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

describe('withAutoSourceAnnotation — implicit annotateSource injection', () => {
  it('prepends annotateSource on a bare inline glob target', () => {
    const target = resolveDiffSide({ left: 'data/*.ttl' }, 'left');
    const out = withAutoSourceAnnotation(target, { skipAuto: false });
    expect(out.kind).toBe('glob');
    if (out.kind !== 'glob') return;
    expect(out.transforms?.[0]).toMatchObject({ key: 'annotateSource' });
  });

  it('is a no-op when skipAuto is true (--skip-auto-source-annotation)', () => {
    const target = resolveDiffSide({ left: 'data/*.ttl' }, 'left');
    const out = withAutoSourceAnnotation(target, { skipAuto: true });
    expect(out).toBe(target);
    if (out.kind === 'glob') {
      expect(out.transforms).toBeUndefined();
    }
  });

  it('preserves an explicit annotateSource declaration with custom predicates (no double-apply)', () => {
    const target = resolveDiffSide(
      {
        sources: [
          {
            id: 'src',
            glob: 'data/*.ttl',
            transforms: [
              {
                annotateSource: {
                  source: 'urn:custom:src',
                  file: 'urn:custom:file',
                  line: 'urn:custom:line',
                },
              },
            ],
          },
        ],
        left: '@src',
      },
      'left',
    );
    const out = withAutoSourceAnnotation(target, { skipAuto: false });
    expect(out.kind).toBe('glob');
    if (out.kind !== 'glob') return;
    expect(out.transforms).toHaveLength(1);
    expect(out.transforms?.[0]).toMatchObject({
      key: 'annotateSource',
      config: {
        source: 'urn:custom:src',
        file: 'urn:custom:file',
        line: 'urn:custom:line',
      },
    });
  });

  it('does not mutate the input target.transforms array', () => {
    const target = resolveDiffSide(
      {
        sources: [
          {
            id: 'src',
            glob: 'data/*.ttl',
            transforms: [{ graphName: 'forceAll' }],
          },
        ],
        left: '@src',
      },
      'left',
    );
    if (target.kind !== 'glob') throw new Error('unreachable');
    const before = target.transforms?.slice();
    const out = withAutoSourceAnnotation(target, { skipAuto: false });
    expect(target.transforms).toEqual(before);
    expect(out).not.toBe(target);
    if (out.kind !== 'glob') return;
    expect(out.transforms?.[0]).toMatchObject({ key: 'annotateSource' });
    expect(out.transforms?.[1]).toMatchObject({ key: 'graphName' });
  });

  it('is a no-op on a view target (annotations cannot propagate through views)', () => {
    const target = resolveDiffSide(
      {
        sources: [
          { id: 'raw', glob: 'data/*.ttl' },
          {
            id: 'kept',
            from: '@raw',
            query:
              'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ex:p ?o } WHERE { ?s ex:p ?o }',
          },
        ],
        left: '@kept',
      },
      'left',
    );
    const out = withAutoSourceAnnotation(target, { skipAuto: false });
    expect(out).toBe(target);
    expect(out.kind).toBe('view');
  });

  it('is a no-op on an endpoint target', () => {
    const target = resolveDiffSide(
      {
        sources: [
          { id: 'live', endpoint: 'https://example.com/sparql' },
        ],
        left: '@live',
      },
      'left',
    );
    const out = withAutoSourceAnnotation(target, { skipAuto: false });
    expect(out).toBe(target);
    expect(out.kind).toBe('endpoint');
  });

  it('with skipAuto=true, an explicit annotateSource still survives', () => {
    const target = resolveDiffSide(
      {
        sources: [
          {
            id: 'src',
            glob: 'data/*.ttl',
            transforms: [{ annotateSource: { source: 'urn:custom:src' } }],
          },
        ],
        left: '@src',
      },
      'left',
    );
    const out = withAutoSourceAnnotation(target, { skipAuto: true });
    expect(out.kind).toBe('glob');
    if (out.kind !== 'glob') return;
    expect(out.transforms).toHaveLength(1);
    expect(out.transforms?.[0]).toMatchObject({
      key: 'annotateSource',
      config: { source: 'urn:custom:src' },
    });
  });
});

describe('diffSpec — --skip-auto-source-annotation flag', () => {
  it('declares the flag with a description that names the glob-target carve-out', () => {
    const flags =
      diffSpec.fields.find((f) => f.key === 'skipAutoSourceAnnotation')?.flags ??
      [];
    expect(flags.length).toBeGreaterThan(0);
    expect(flags[0].spec).toBe('--skip-auto-source-annotation');
    expect(flags[0].description).toMatch(/glob/);
  });

  it('defaults to false', () => {
    expect(defaultsFromFields(diffSpec.fields)).toMatchObject({
      skipAutoSourceAnnotation: false,
    });
  });

  it('coerces the string "true" to a boolean (env-style)', () => {
    const schema = blockSchemaFromFields(diffSpec.fields);
    const r = schema.safeParse({ skipAutoSourceAnnotation: 'true' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(
        (r.data as { skipAutoSourceAnnotation: boolean })
          .skipAutoSourceAnnotation,
      ).toBe(true);
    }
  });
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

describe('collectSnippetKeysForDiff — scope to changed hunks only', () => {
  // Auto-injected `annotateSource` populates the per-side records map for
  // every asserted triple, not just the changed ones. The HTML composer only
  // ever renders snippets for `diff.added` / `diff.removed`, so the snippet
  // fetcher must scope to those — otherwise large unchanged stores produce
  // tens of thousands of redundant `createReadStream` calls and exhaust the
  // heap. (regression: ERA shapes ~16k-line ttl OOMing the v8 heap)
  it('returns only keys whose canonical statement is in diff.added (right) or diff.removed (left), ignoring unchanged-triple records', () => {
    const sourceRecords = {
      left: new Map([
        ['<a> <p> <b> .', [{ file: 'file:///left.ttl', line: 10 }]],
        ['<a> <p> <gone> .', [{ file: 'file:///left.ttl', line: 20 }]],
        ['<a> <p> <c> .', [{ file: 'file:///left.ttl', line: 30 }]],
      ]),
      right: new Map([
        ['<a> <p> <b> .', [{ file: 'file:///right.ttl', line: 10 }]],
        ['<a> <p> <new> .', [{ file: 'file:///right.ttl', line: 25 }]],
        ['<a> <p> <c> .', [{ file: 'file:///right.ttl', line: 30 }]],
      ]),
    };
    const diff = {
      added: ['<a> <p> <new> .'],
      removed: ['<a> <p> <gone> .'],
    };

    const keys = collectSnippetKeysForDiff(diff, sourceRecords);

    expect([...keys.keys()].sort()).toEqual([
      'file:///left.ttl:20',
      'file:///right.ttl:25',
    ]);
  });

  it('dedupes identical (file, line) pairs across multiple records on the same hunk', () => {
    const sourceRecords = {
      left: new Map(),
      right: new Map([
        [
          '<a> <p> <new> .',
          [
            { file: 'file:///r.ttl', line: 7 },
            { file: 'file:///r.ttl', line: 7 },
          ],
        ],
      ]),
    };
    const keys = collectSnippetKeysForDiff(
      { added: ['<a> <p> <new> .'], removed: [] },
      sourceRecords,
    );
    expect([...keys.keys()]).toEqual(['file:///r.ttl:7']);
  });

  it('skips records that do not carry a line', () => {
    const sourceRecords = {
      left: new Map([
        ['<a> <p> <gone> .', [{ file: 'file:///l.ttl' }]],
      ]),
      right: new Map(),
    };
    const keys = collectSnippetKeysForDiff(
      { added: [], removed: ['<a> <p> <gone> .'] },
      sourceRecords,
    );
    expect(keys.size).toBe(0);
  });

  it('returns an empty map when the diff is empty, even with thousands of records present', () => {
    const left = new Map<string, { file: string; line: number }[]>();
    for (let i = 0; i < 5000; i++) {
      left.set(`stmt${i}`, [{ file: 'file:///l.ttl', line: i }]);
    }
    const keys = collectSnippetKeysForDiff(
      { added: [], removed: [] },
      { left, right: new Map() },
    );
    expect(keys.size).toBe(0);
  });
});
