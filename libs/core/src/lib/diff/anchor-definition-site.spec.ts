import { DataFactory, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import { buildSourceRecord, DEFAULT_ANNOTATION_PREDICATE_IRIS } from '../sources';
import { anchorDefinitionSite } from './anchor-definition-site';

const { namedNode, quad } = DataFactory;
const ex = (s: string): string => `http://example.org/${s}`;

interface Entry {
  s: string;
  p: string;
  o: string;
  file: string;
  line?: number;
  endLine?: number;
}

function annotatedStore(entries: ReadonlyArray<Entry>): Store {
  const store = new Store();
  for (const e of entries) {
    const asserted = quad(namedNode(ex(e.s)), namedNode(ex(e.p)), namedNode(ex(e.o)));
    store.addQuad(asserted);
    store.addQuads(
      buildSourceRecord({
        asserted,
        filePath: e.file,
        line: e.line,
        endLine: e.endLine,
        predicates: DEFAULT_ANNOTATION_PREDICATE_IRIS,
      }),
    );
  }
  return store;
}

describe('anchorDefinitionSite', () => {
  it("returns one record per file at that file's earliest annotated line of the anchor", () => {
    const store = annotatedStore([
      { s: 'Alice', p: 'name', o: 'AliceName', file: '/x/a.ttl', line: 7 },
      { s: 'Alice', p: 'age', o: 'AliceAge', file: '/x/a.ttl', line: 5 },
    ]);
    expect(anchorDefinitionSite(store, ex('Alice'))).toEqual([
      { file: 'file:///x/a.ttl', line: 5 },
    ]);
  });

  it('emits one record per file when the anchor is annotated across two files', () => {
    const store = annotatedStore([
      { s: 'Alice', p: 'name', o: 'AliceName', file: '/x/a.ttl', line: 7 },
      { s: 'Alice', p: 'age', o: 'AliceAge', file: '/x/b.ttl', line: 12 },
      { s: 'Alice', p: 'email', o: 'AliceMail', file: '/x/b.ttl', line: 9 },
    ]);
    expect(anchorDefinitionSite(store, ex('Alice'))).toEqual([
      { file: 'file:///x/a.ttl', line: 7 },
      { file: 'file:///x/b.ttl', line: 9 },
    ]);
  });

  it('resolves an untyped subject by its minimum annotated line (no rdf:type assumption)', () => {
    // No rdf:type triple on the anchor at all.
    const store = annotatedStore([
      { s: 'Plain', p: 'label', o: 'PlainLabel', file: '/x/a.ttl', line: 20 },
      { s: 'Plain', p: 'note', o: 'PlainNote', file: '/x/a.ttl', line: 14 },
    ]);
    expect(anchorDefinitionSite(store, ex('Plain'))).toEqual([
      { file: 'file:///x/a.ttl', line: 14 },
    ]);
  });

  it('returns an empty array when the anchor is absent from the store', () => {
    const store = annotatedStore([
      { s: 'Bob', p: 'name', o: 'BobName', file: '/x/a.ttl', line: 3 },
    ]);
    expect(anchorDefinitionSite(store, ex('Alice'))).toEqual([]);
  });

  it('returns an empty array when the store has no sparqly:source annotations at all', () => {
    const store = new Store();
    store.addQuad(quad(namedNode(ex('Alice')), namedNode(ex('name')), namedNode(ex('AliceName'))));
    expect(anchorDefinitionSite(store, ex('Alice'))).toEqual([]);
  });
});
