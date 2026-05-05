import { DataFactory, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import {
  ANNOTATE_SOURCE_TRANSFORM,
  parseAnnotateTransform,
} from './annotate-transform';
import { DEFAULT_ANNOTATION_PREDICATE_IRIS } from './source-record-builder';
import type { RdfRecord } from './rdf-file-parser';

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

describe('ANNOTATE_SOURCE_TRANSFORM registry definition', () => {
  it('uses the key "annotateSource"', () => {
    expect(ANNOTATE_SOURCE_TRANSFORM.key).toBe('annotateSource');
  });

  it('defaults to the documented urn:sparqly:* predicates', () => {
    expect(DEFAULT_ANNOTATION_PREDICATE_IRIS).toEqual({
      source: 'urn:sparqly:source',
      file: 'urn:sparqly:file',
      line: 'urn:sparqly:line',
    });
  });
});
