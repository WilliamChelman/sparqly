import { describe, expect, it } from 'vitest';
import {
  blockSchemaFromFields,
  defaultsFromFields,
} from '../../runner/fields/field';
import { DiffErrorSignal } from '../diff-error';
import { diffSpec } from './diff';
import { inferDiffFormatFromOut } from './fields';
import { collectSnippetKeysForHunkedDiff } from './graph-runner';
import { resolveDiffSide } from './side';
import { detectTabularDispatch } from './tabular-runner';

const TRIPLES_CONSTRUCT =
  'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ex:p ?o } WHERE { ?s ex:p ?o }';
const TRIPLES_SELECT_SPO =
  'PREFIX ex: <http://example.org/> SELECT ?s ?p ?o WHERE { ?s ?p ?o }';
const TUPLES_SELECT =
  'PREFIX ex: <http://example.org/> SELECT ?id WHERE { ?p ex:id ?id }';

describe('diffSpec', () => {
  it('declares two positionals bound to left and right', () => {
    expect(diffSpec.positionals).toEqual([
      { field: 'left', name: 'left' },
      { field: 'right', name: 'right' },
    ]);
  });

  it('exposes no env mirrors on per-invocation fields per ADR-0010', () => {
    const perInvocation = [
      'left',
      'right',
      'query',
      'queryFile',
      'leftQuery',
      'leftQueryFile',
      'rightQuery',
      'rightQueryFile',
      'format',
      'snippetContext',
      'out',
    ];
    for (const key of perInvocation) {
      const field = diffSpec.fields.find((f) => f.key === key);
      expect(field, `field ${key}`).toBeDefined();
      expect(field?.env, `env on ${key}`).toBeUndefined();
    }
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

  it('rejects --snippet-context above 100', () => {
    const schema = blockSchemaFromFields(diffSpec.fields);
    expect(schema.safeParse({ snippetContext: 101 }).success).toBe(false);
    expect(schema.safeParse({ snippetContext: 100 }).success).toBe(true);
    expect(schema.safeParse({ snippetContext: 0 }).success).toBe(true);
  });

  it('rejects negative or non-integer --snippet-context', () => {
    const schema = blockSchemaFromFields(diffSpec.fields);
    expect(schema.safeParse({ snippetContext: -1 }).success).toBe(false);
    expect(schema.safeParse({ snippetContext: 1.5 }).success).toBe(false);
  });

  it('rejects --snippet-context against any non-html format (loud-error, no silent ignore)', () => {
    const schema = blockSchemaFromFields(diffSpec.fields);
    // Refined schema lives on diffSpec.refine; build a refined version like the runner does.
    const refined = diffSpec.refine
      ? diffSpec.refine(schema as never)
      : schema;
    for (const f of ['human', 'json', 'rdf-patch', 'turtle']) {
      const r = refined.safeParse({ format: f, snippetContext: 5 });
      expect(r.success).toBe(false);
      if (!r.success) {
        const msg = r.error.issues.map((i) => i.message).join('\n');
        expect(msg).toMatch(/--snippet-context/);
        expect(msg).toMatch(/html/);
      }
    }
    expect(refined.safeParse({ format: 'html', snippetContext: 5 }).success).toBe(
      true,
    );
  });

  it('accepts --snippet-context when --format is omitted but --out infers html (e.g. .html)', () => {
    const schema = blockSchemaFromFields(diffSpec.fields);
    const refined = diffSpec.refine
      ? diffSpec.refine(schema as never)
      : schema;
    const r = refined.safeParse({ snippetContext: 5, out: 'fedlex-diff.html' });
    expect(r.success).toBe(true);
  });

  it('still rejects --snippet-context when --format is explicitly non-html (explicit wins over --out inference)', () => {
    const schema = blockSchemaFromFields(diffSpec.fields);
    const refined = diffSpec.refine
      ? diffSpec.refine(schema as never)
      : schema;
    const r = refined.safeParse({
      snippetContext: 5,
      format: 'human',
      out: 'fedlex-diff.html',
    });
    expect(r.success).toBe(false);
  });

  it('declares verbose/quiet defaults and no static default for format (resolved at handler time via --out inference)', () => {
    const defaults = defaultsFromFields(diffSpec.fields);
    expect(defaults).toMatchObject({
      verbose: false,
      quiet: false,
    });
    expect(defaults.format).toBeUndefined();
    expect('graphMode' in defaults).toBe(false);
  });

  it('does not expose a top-level graphMode field (graph-name semantics live on transforms)', () => {
    expect(diffSpec.fields.find((f) => f.key === 'graphMode')).toBeUndefined();
    const flagSpecs = diffSpec.fields.flatMap((f) => f.flags ?? []).map(
      (f) => f.spec,
    );
    for (const s of flagSpecs) expect(s).not.toMatch(/--graph-mode/);
  });

  it('exitCode returns 2 by default for unknown errors', () => {
    expect(diffSpec.exitCode(new Error('boom'))).toBe(2);
  });

  it('exitCode routes a DiffErrorSignal through diffErrorExitCode (per-variant map)', () => {
    expect(
      diffSpec.exitCode(
        new DiffErrorSignal({ kind: 'tabular-blank-node', column: 'x' }),
      ),
    ).toBe(10);
    expect(
      diffSpec.exitCode(
        new DiffErrorSignal({
          kind: 'anonymous-view-execution',
          side: 'left',
          message: 'parse failed',
        }),
      ),
    ).toBe(20);
    expect(
      diffSpec.exitCode(
        new DiffErrorSignal({
          kind: 'endpoint-as-diff-target',
          side: 'right',
          endpoint: 'https://example.org/sparql',
        }),
      ),
    ).toBe(14);
  });
});

describe('inferDiffFormatFromOut — derive --format from --out extension', () => {
  it('returns html for a .html out path', () => {
    expect(inferDiffFormatFromOut('foo.html')).toBe('html');
  });

  it('returns html for a .htm out path', () => {
    expect(inferDiffFormatFromOut('foo.htm')).toBe('html');
  });

  it('returns json for a .json out path', () => {
    expect(inferDiffFormatFromOut('foo.json')).toBe('json');
  });

  it('returns turtle for a .ttl out path', () => {
    expect(inferDiffFormatFromOut('foo.ttl')).toBe('turtle');
  });

  it('returns undefined for an unrecognized extension', () => {
    expect(inferDiffFormatFromOut('foo.txt')).toBeUndefined();
    expect(inferDiffFormatFromOut('foo')).toBeUndefined();
  });

  it('returns undefined when out is undefined', () => {
    expect(inferDiffFormatFromOut(undefined)).toBeUndefined();
  });

  it('matches case-insensitively (.HTML, .Json)', () => {
    expect(inferDiffFormatFromOut('foo.HTML')).toBe('html');
    expect(inferDiffFormatFromOut('foo.Json')).toBe('json');
  });
});

describe('detectTabularDispatch — shape-driven mode dispatch', () => {
  it('returns undefined when only one side has an inline query (graph fallback)', () => {
    expect(detectTabularDispatch(TUPLES_SELECT, undefined)).toBeUndefined();
    expect(detectTabularDispatch(undefined, TUPLES_SELECT)).toBeUndefined();
  });

  it('returns undefined when both sides are triples-shape (graph diff path owns it)', () => {
    expect(
      detectTabularDispatch(TRIPLES_CONSTRUCT, TRIPLES_SELECT_SPO),
    ).toBeUndefined();
  });

  it('returns the per-side shapes when both sides are tuples-shape', () => {
    const out = detectTabularDispatch(TUPLES_SELECT, TUPLES_SELECT);
    expect(out).toBeDefined();
    expect(out?.left.shape).toBe('tuples');
    expect(out?.right.shape).toBe('tuples');
  });

  it('throws on mixed shape: triples-shape left + tuples-shape right', () => {
    expect(() =>
      detectTabularDispatch(TRIPLES_CONSTRUCT, TUPLES_SELECT),
    ).toThrow(/mixed.*shape|shape mismatch/i);
  });

  it('throws on mixed shape: tuples-shape left + triples-shape right', () => {
    expect(() =>
      detectTabularDispatch(TUPLES_SELECT, TRIPLES_SELECT_SPO),
    ).toThrow(/mixed.*shape|shape mismatch/i);
  });

  it('mixed-shape error names which side is which (actionable diagnosis)', () => {
    try {
      detectTabularDispatch(TRIPLES_CONSTRUCT, TUPLES_SELECT);
      throw new Error('expected throw');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/left/);
      expect(msg).toMatch(/right/);
      // points the user at a fix
      expect(msg).toMatch(/CONSTRUCT|SELECT/);
    }
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

describe('diffSpec — --skip-auto-source-annotation flag removed (ADR-0032)', () => {
  it('no longer declares a skipAutoSourceAnnotation field', () => {
    expect(
      diffSpec.fields.find((f) => f.key === 'skipAutoSourceAnnotation'),
    ).toBeUndefined();
  });

  it('no longer declares a --skip-auto-source-annotation flag on any field', () => {
    const allFlagSpecs = diffSpec.fields.flatMap((f) => f.flags ?? []).map(
      (f) => f.spec,
    );
    for (const s of allFlagSpecs) {
      expect(s).not.toMatch(/--skip-auto-source-annotation/);
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

describe('collectSnippetKeysForHunkedDiff — scope to changed hunks only', () => {
  // Hunks built by `groupRdfDiffByEntity` only carry sourceRecords gathered
  // from changed lines, so unchanged-triple records can never reach this
  // function. This protects against a previous regression where iterating
  // the full per-side records map (auto-`annotateSource`) walked every triple
  // in 16k-line .ttl inputs and OOM'd v8.
  function hunk(
    over: Partial<{
      left: { file: string; line?: number }[];
      right: { file: string; line?: number }[];
    }> = {},
  ) {
    return {
      anchor: 'http://example.org/X',
      state: 'changed' as const,
      removed: 0,
      added: 0,
      lines: [],
      sourceRecords: {
        left: over.left ?? [],
        right: over.right ?? [],
      },
    };
  }

  it('returns the union of unique (file, line) keys across both sides of every hunk', () => {
    const keys = collectSnippetKeysForHunkedDiff({
      hunks: [
        hunk({
          left: [{ file: 'file:///l.ttl', line: 20 }],
          right: [{ file: 'file:///r.ttl', line: 25 }],
        }),
      ],
    });

    expect([...keys.keys()].sort()).toEqual([
      'file:///l.ttl:20',
      'file:///r.ttl:25',
    ]);
  });

  it('dedupes identical (file, line) pairs across multiple records on the same hunk', () => {
    const keys = collectSnippetKeysForHunkedDiff({
      hunks: [
        hunk({
          right: [
            { file: 'file:///r.ttl', line: 7 },
            { file: 'file:///r.ttl', line: 7 },
          ],
        }),
      ],
    });
    expect([...keys.keys()]).toEqual(['file:///r.ttl:7']);
  });

  it('skips records that do not carry a line', () => {
    const keys = collectSnippetKeysForHunkedDiff({
      hunks: [hunk({ left: [{ file: 'file:///l.ttl' }] })],
    });
    expect(keys.size).toBe(0);
  });

  it('returns an empty map when there are no hunks', () => {
    const keys = collectSnippetKeysForHunkedDiff({ hunks: [] });
    expect(keys.size).toBe(0);
  });

  it('includes anchorSource definition-site ranges so `defined here` snippets are bulk-fetched', () => {
    const keys = collectSnippetKeysForHunkedDiff({
      hunks: [
        {
          ...hunk(),
          anchorSource: {
            left: [{ file: 'file:///def.ttl', line: 3 }],
            right: [],
          },
        },
      ],
    });
    expect([...keys.keys()]).toEqual(['file:///def.ttl:3']);
  });
});
