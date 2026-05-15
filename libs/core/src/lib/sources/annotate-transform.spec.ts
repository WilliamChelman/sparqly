import { DataFactory, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import {
  ANNOTATE_SOURCE_TRANSFORM,
  parseAnnotateTransform,
  parseAnnotateTransformResult,
} from './annotate-transform';
import { DEFAULT_ANNOTATION_PREDICATE_IRIS } from './source-record-builder';
import type { RdfRecord } from '../engine';

const { namedNode, quad } = DataFactory;

function ctxOf(perFile: Record<string, ReadonlyArray<RdfRecord>>) {
  return { perFileRecords: new Map(Object.entries(perFile)) };
}

function storeOf(records: ReadonlyArray<RdfRecord>): Store {
  const s = new Store();
  for (const r of records) s.addQuad(r.quad);
  return s;
}

describe('parseAnnotateTransform — schema', () => {
  it('accepts null/undefined as "all defaults"', () => {
    expect(typeof parseAnnotateTransform(undefined)).toBe('function');
    expect(typeof parseAnnotateTransform(null)).toBe('function');
  });

  it('accepts an empty object as "all defaults"', () => {
    expect(typeof parseAnnotateTransform({})).toBe('function');
  });
});

describe('parseAnnotateTransform — schema rejections', () => {
  it('rejects unknown fields with a stable named error', () => {
    expect(() =>
      parseAnnotateTransform({ bogus: 'x' } as unknown),
    ).toThrow(/annotateSource.*unknown key.*bogus.*source.*file.*line/);
  });

  it('rejects non-object non-null values', () => {
    expect(() => parseAnnotateTransform(42 as unknown)).toThrow(
      /annotateSource.*omitted.*null.*object/,
    );
    expect(() => parseAnnotateTransform([] as unknown)).toThrow(
      /annotateSource.*omitted.*null.*object/,
    );
    expect(() => parseAnnotateTransform('forceAll' as unknown)).toThrow(
      /annotateSource.*omitted.*null.*object/,
    );
  });

  it('rejects empty-string IRI override on any of source/file/line', () => {
    expect(() =>
      parseAnnotateTransform({ source: '' } as unknown),
    ).toThrow(/annotateSource.*`source`.*non-empty IRI/);
    expect(() =>
      parseAnnotateTransform({ file: '' } as unknown),
    ).toThrow(/annotateSource.*`file`.*non-empty IRI/);
    expect(() =>
      parseAnnotateTransform({ line: '' } as unknown),
    ).toThrow(/annotateSource.*`line`.*non-empty IRI/);
  });
});

describe('annotate transform behaviour — apply', () => {
  it('throws when invoked without per-file context', () => {
    const apply = parseAnnotateTransform({});
    expect(() => apply(new Store())).toThrow(
      /annotateSource.*per-file context/,
    );
  });

  it('preserves all asserted quads from the input store and adds source records', () => {
    const r: RdfRecord = {
      quad: quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
      line: 3,
    };
    const input = storeOf([r]);
    const apply = parseAnnotateTransform({});
    const out = apply(input, ctxOf({ '/abs/a.ttl': [r] }));

    // Original asserted quad survives.
    const asserted = out.getQuads(
      namedNode('urn:s'),
      namedNode('urn:p'),
      namedNode('urn:o'),
      null,
    );
    expect(asserted).toHaveLength(1);

    // A source-record quad pointing at file:///abs/a.ttl exists.
    const fileQuads = out.getQuads(
      null,
      namedNode(DEFAULT_ANNOTATION_PREDICATE_IRIS.file),
      null,
      null,
    );
    expect(fileQuads).toHaveLength(1);
    expect(fileQuads[0].object.value).toBe('file:///abs/a.ttl');

    const lineQuads = out.getQuads(
      null,
      namedNode(DEFAULT_ANNOTATION_PREDICATE_IRIS.line),
      null,
      null,
    );
    expect(lineQuads).toHaveLength(1);
    expect(lineQuads[0].object.value).toBe('3');
  });

  it('does not mutate the input store', () => {
    const r: RdfRecord = {
      quad: quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
      line: 1,
    };
    const input = storeOf([r]);
    const apply = parseAnnotateTransform({});
    apply(input, ctxOf({ '/abs/a.ttl': [r] }));
    expect(input.size).toBe(1);
  });

  it('emits no line predicate when the parser did not supply a line', () => {
    const r: RdfRecord = {
      quad: quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
    };
    const apply = parseAnnotateTransform({});
    const out = apply(storeOf([r]), ctxOf({ '/abs/a.jsonld': [r] }));
    const lineQuads = out.getQuads(
      null,
      namedNode(DEFAULT_ANNOTATION_PREDICATE_IRIS.line),
      null,
      null,
    );
    expect(lineQuads).toHaveLength(0);
  });
});

describe('annotate transform — pin provenance (ADR-0029, #273)', () => {
  it('emits sparqly:gitRef + sparqly:gitSha quads under each source record when ctx.pin is set', () => {
    const r: RdfRecord = {
      quad: quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
      line: 3,
    };
    const apply = parseAnnotateTransform({});
    const out = apply(storeOf([r]), {
      perFileRecords: new Map([['/abs/a.ttl', [r]]]),
      pin: {
        ref: 'main',
        sha: '0123456789abcdef0123456789abcdef01234567',
      },
    });

    const gitRefQuads = out.getQuads(
      null,
      namedNode(DEFAULT_ANNOTATION_PREDICATE_IRIS.gitRef),
      null,
      null,
    );
    expect(gitRefQuads).toHaveLength(1);
    expect(gitRefQuads[0].object.value).toBe('main');

    const gitShaQuads = out.getQuads(
      null,
      namedNode(DEFAULT_ANNOTATION_PREDICATE_IRIS.gitSha),
      null,
      null,
    );
    expect(gitShaQuads).toHaveLength(1);
    expect(gitShaQuads[0].object.value).toBe(
      '0123456789abcdef0123456789abcdef01234567',
    );
  });

  it('omits both gitRef + gitSha when ctx.pin is absent (unpinned-source byte-for-byte invariant)', () => {
    const r: RdfRecord = {
      quad: quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
      line: 1,
    };
    const apply = parseAnnotateTransform({});
    const out = apply(
      storeOf([r]),
      { perFileRecords: new Map([['/abs/a.ttl', [r]]]) },
    );
    expect(
      out.getQuads(null, namedNode(DEFAULT_ANNOTATION_PREDICATE_IRIS.gitRef), null, null),
    ).toHaveLength(0);
    expect(
      out.getQuads(null, namedNode(DEFAULT_ANNOTATION_PREDICATE_IRIS.gitSha), null, null),
    ).toHaveLength(0);
  });
});

describe('parseAnnotateTransformResult — Result-typed primary impl', () => {
  it('returns ok with a ParsedTransformResult for null/undefined (all defaults)', () => {
    const result = parseAnnotateTransformResult(undefined);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(typeof result.value.apply).toBe('function');
    expect(result.value.config).toEqual(DEFAULT_ANNOTATION_PREDICATE_IRIS);
  });

  it('returns ok with overridden config when a partial IRI map is supplied', () => {
    const result = parseAnnotateTransformResult({ source: 'urn:my:source' });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect((result.value.config as { source: string }).source).toBe(
      'urn:my:source',
    );
  });

  it('returns err with a transform-parse variant naming the transform key for an unknown field', () => {
    const result = parseAnnotateTransformResult({ bogus: 'x' });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('transform-parse');
    expect(result.error.transformKey).toBe('annotateSource');
    expect(result.error.message).toMatch(/unknown key.*bogus/);
  });

  it('returns err with transform-parse for a non-object non-null value', () => {
    const result = parseAnnotateTransformResult(42 as unknown);
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('transform-parse');
    expect(result.error.transformKey).toBe('annotateSource');
  });

  it('returns err with transform-parse for an empty-string IRI override', () => {
    const result = parseAnnotateTransformResult({ source: '' });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('transform-parse');
    expect(result.error.message).toMatch(/`source`.*non-empty IRI/);
  });
});

describe('parseAnnotateTransform — legacy throw-wrapping adapter', () => {
  it('still throws on a bad field, preserving the legacy message shape', () => {
    expect(() => parseAnnotateTransform({ bogus: 'x' } as unknown)).toThrow(
      /unknown key.*bogus/,
    );
  });
});

describe('ANNOTATE_SOURCE_TRANSFORM registry definition', () => {
  it('uses the key "annotateSource"', () => {
    expect(ANNOTATE_SOURCE_TRANSFORM.key).toBe('annotateSource');
  });

  it('defaults to the documented urn:sparqly:* predicates', () => {
    expect(DEFAULT_ANNOTATION_PREDICATE_IRIS).toEqual({
      source: 'urn:sparqly:source',
      file: 'urn:sparqly:file',
      line: 'urn:sparqly:line',
      endLine: 'urn:sparqly:endLine',
      gitRef: 'urn:sparqly:gitRef',
      gitSha: 'urn:sparqly:gitSha',
    });
  });
});
