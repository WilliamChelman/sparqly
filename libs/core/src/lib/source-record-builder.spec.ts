import { DataFactory } from 'n3';
import { describe, expect, it } from 'vitest';
import {
  buildSourceRecord,
  DEFAULT_ANNOTATION_PREDICATE_IRIS,
  type AnnotationPredicateIris,
} from './source-record-builder';

const { namedNode, quad } = DataFactory;

const SPO = quad(
  namedNode('urn:s'),
  namedNode('urn:p'),
  namedNode('urn:o'),
);

const XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';

function lookupSourceQuads(
  quads: ReadonlyArray<ReturnType<typeof quad>>,
  sourcePredicate: string,
) {
  return quads.filter(
    (q) =>
      (q.subject.termType as string) === 'Quad' &&
      q.predicate.termType === 'NamedNode' &&
      q.predicate.value === sourcePredicate,
  );
}

describe('buildSourceRecord — multi-source on same triple', () => {
  it('produces two records with distinct blank nodes under one quoted-triple subject', () => {
    const a = buildSourceRecord({
      asserted: SPO,
      filePath: '/abs/a.ttl',
      line: 1,
      predicates: DEFAULT_ANNOTATION_PREDICATE_IRIS,
    });
    const b = buildSourceRecord({
      asserted: SPO,
      filePath: '/abs/b.ttl',
      line: 2,
      predicates: DEFAULT_ANNOTATION_PREDICATE_IRIS,
    });

    const sourceA = lookupSourceQuads(a, DEFAULT_ANNOTATION_PREDICATE_IRIS.source)[0];
    const sourceB = lookupSourceQuads(b, DEFAULT_ANNOTATION_PREDICATE_IRIS.source)[0];

    // Quoted-triple subjects are equal (same s,p,o → same Quad term value).
    expect(sourceA.subject.equals(sourceB.subject)).toBe(true);
    // But the blank-node records differ.
    expect(sourceA.object.equals(sourceB.object)).toBe(false);
  });
});

describe('buildSourceRecord — custom predicate IRIs', () => {
  it.each([
    ['source override only', { source: 'http://my/source' }],
    ['file override only', { file: 'http://my/file' }],
    ['line override only', { line: 'http://my/line' }],
    [
      'all three overridden',
      {
        source: 'http://my/source',
        file: 'http://my/file',
        line: 'http://my/line',
      },
    ],
  ] as const)('uses %s', (_label, overrides) => {
    const predicates: AnnotationPredicateIris = {
      ...DEFAULT_ANNOTATION_PREDICATE_IRIS,
      ...overrides,
    };
    const out = buildSourceRecord({
      asserted: SPO,
      filePath: '/abs/a.ttl',
      line: 7,
      predicates,
    });
    const usedPredicates = new Set(out.map((q) => q.predicate.value));
    expect(usedPredicates).toEqual(
      new Set([predicates.source, predicates.file, predicates.line]),
    );
  });
});

describe('buildSourceRecord — wire shape without line', () => {
  it('omits the line predicate entirely when line is undefined', () => {
    const out = buildSourceRecord({
      asserted: SPO,
      filePath: '/abs/a.jsonld',
      predicates: DEFAULT_ANNOTATION_PREDICATE_IRIS,
    });

    expect(out).toHaveLength(2);
    const linePresent = out.some(
      (q) => q.predicate.value === DEFAULT_ANNOTATION_PREDICATE_IRIS.line,
    );
    expect(linePresent).toBe(false);

    // file IRI is still emitted.
    const fileQ = out.find(
      (q) => q.predicate.value === DEFAULT_ANNOTATION_PREDICATE_IRIS.file,
    );
    expect(fileQ?.object.value).toBe('file:///abs/a.jsonld');
  });
});

describe('buildSourceRecord — wire shape with line', () => {
  it('emits source/file/line quads under a blank-node record', () => {
    const out = buildSourceRecord({
      asserted: SPO,
      filePath: '/abs/path/a.ttl',
      line: 5,
      predicates: DEFAULT_ANNOTATION_PREDICATE_IRIS,
    });

    expect(out).toHaveLength(3);
    const sourceQuads = lookupSourceQuads(
      out,
      DEFAULT_ANNOTATION_PREDICATE_IRIS.source,
    );
    expect(sourceQuads).toHaveLength(1);
    const sourceQ = sourceQuads[0];

    // Quoted-triple subject preserves s/p/o.
    const qts = sourceQ.subject as unknown as ReturnType<typeof quad>;
    expect((qts as { termType: string }).termType).toBe('Quad');
    expect(qts.subject.value).toBe('urn:s');
    expect(qts.predicate.value).toBe('urn:p');
    expect(qts.object.value).toBe('urn:o');

    // Blank node groups (file, line).
    const record = sourceQ.object;
    expect(record.termType).toBe('BlankNode');

    const fileQ = out.find(
      (q) =>
        q.subject.equals(record) &&
        q.predicate.value === DEFAULT_ANNOTATION_PREDICATE_IRIS.file,
    );
    expect(fileQ?.object.termType).toBe('NamedNode');
    expect(fileQ?.object.value).toBe('file:///abs/path/a.ttl');

    const lineQ = out.find(
      (q) =>
        q.subject.equals(record) &&
        q.predicate.value === DEFAULT_ANNOTATION_PREDICATE_IRIS.line,
    );
    expect(lineQ?.object.termType).toBe('Literal');
    expect(lineQ?.object.value).toBe('5');
    expect(
      (lineQ?.object as { datatype: { value: string } }).datatype.value,
    ).toBe(XSD_INTEGER);
  });
});
