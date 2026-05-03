import { DataFactory, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import { buildSourceRecord, DEFAULT_ANNOTATION_PREDICATE_IRIS } from './source-record-builder';
import { stripAnnotations } from './strip-annotations';

const { namedNode, quad, literal } = DataFactory;

function makeAsserted() {
  return [
    quad(namedNode('urn:s1'), namedNode('urn:p1'), namedNode('urn:o1')),
    quad(namedNode('urn:s2'), namedNode('urn:p2'), literal('lit')),
  ];
}

function annotatedStore(opts: {
  predicates?: typeof DEFAULT_ANNOTATION_PREDICATE_IRIS;
  withLine?: boolean;
}) {
  const predicates = opts.predicates ?? DEFAULT_ANNOTATION_PREDICATE_IRIS;
  const asserted = makeAsserted();
  const store = new Store();
  for (const q of asserted) store.addQuad(q);
  for (const q of asserted) {
    for (const r of buildSourceRecord({
      asserted: q,
      filePath: '/abs/path/file.ttl',
      line: opts.withLine ? 1 : undefined,
      predicates,
    })) {
      store.addQuad(r);
    }
  }
  return { asserted, store, predicates };
}

describe('stripAnnotations', () => {
  it('returns a store with zero annotation triples for the configured predicates', () => {
    const { store, predicates } = annotatedStore({ withLine: true });
    const out = stripAnnotations(store, predicates);
    for (const iri of [predicates.source, predicates.file, predicates.line]) {
      expect(out.getQuads(null, namedNode(iri), null, null)).toHaveLength(0);
    }
  });

  it('returns a store with zero quoted-triple-subject quads', () => {
    const { store, predicates } = annotatedStore({ withLine: true });
    const out = stripAnnotations(store, predicates);
    const remaining = out.getQuads(null, null, null, null);
    for (const q of remaining) {
      expect(q.subject.termType).not.toBe('Quad');
    }
  });

  it('preserves every asserted triple byte-for-byte', () => {
    const { asserted, store, predicates } = annotatedStore({ withLine: true });
    const out = stripAnnotations(store, predicates);
    expect(out.size).toBe(asserted.length);
    for (const q of asserted) {
      expect(out.getQuads(q.subject, q.predicate, q.object, q.graph)).toHaveLength(1);
    }
  });

  it('does not mutate the input store', () => {
    const { store, predicates } = annotatedStore({ withLine: true });
    const sizeBefore = store.size;
    stripAnnotations(store, predicates);
    expect(store.size).toBe(sizeBefore);
  });

  it('honours configured predicate IRIs (overrides)', () => {
    const custom = {
      source: 'http://example.org/src',
      file: 'http://example.org/f',
      line: 'http://example.org/l',
    };
    const { store } = annotatedStore({ predicates: custom, withLine: true });
    // Defaults must NOT strip the custom predicates.
    const outDefault = stripAnnotations(store, DEFAULT_ANNOTATION_PREDICATE_IRIS);
    expect(outDefault.size).toBeGreaterThan(makeAsserted().length);
    // Custom predicates strip cleanly.
    const outCustom = stripAnnotations(store, custom);
    expect(outCustom.size).toBe(makeAsserted().length);
    expect(outCustom.getQuads(null, namedNode(custom.file), null, null)).toHaveLength(0);
  });

  it('is a no-op on an unannotated store', () => {
    const asserted = makeAsserted();
    const store = new Store();
    for (const q of asserted) store.addQuad(q);
    const out = stripAnnotations(store, DEFAULT_ANNOTATION_PREDICATE_IRIS);
    expect(out.size).toBe(asserted.length);
  });
});
