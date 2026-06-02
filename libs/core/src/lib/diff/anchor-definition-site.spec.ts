import { DataFactory, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import {
  buildSourceRecordSidecar,
  type SidecarLoaderRecord,
  type SourceRecordSidecar,
} from '../sources';
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

function buildSide(
  entries: ReadonlyArray<Entry>,
  pin?: { ref: string; sha: string },
): {
  store: Store;
  sourceRecords: SourceRecordSidecar;
} {
  const store = new Store();
  const perFile = new Map<string, SidecarLoaderRecord[]>();
  for (const e of entries) {
    const asserted = quad(namedNode(ex(e.s)), namedNode(ex(e.p)), namedNode(ex(e.o)));
    store.addQuad(asserted);
    let bucket = perFile.get(e.file);
    if (bucket === undefined) {
      bucket = [];
      perFile.set(e.file, bucket);
    }
    const rec: SidecarLoaderRecord = { quad: asserted };
    if (e.line !== undefined) rec.line = e.line;
    if (e.endLine !== undefined) rec.endLine = e.endLine;
    bucket.push(rec);
  }
  return { store, sourceRecords: buildSourceRecordSidecar(perFile, pin) };
}

describe('anchorDefinitionSite', () => {
  it("returns one record per file at that file's earliest annotated line of the anchor", () => {
    const { store, sourceRecords } = buildSide([
      { s: 'Alice', p: 'name', o: 'AliceName', file: '/x/a.ttl', line: 7 },
      { s: 'Alice', p: 'age', o: 'AliceAge', file: '/x/a.ttl', line: 5 },
    ]);
    expect(anchorDefinitionSite(store, ex('Alice'), sourceRecords)).toEqual([
      { file: 'file:///x/a.ttl', line: 5 },
    ]);
  });

  it('emits one record per file when the anchor is annotated across two files', () => {
    const { store, sourceRecords } = buildSide([
      { s: 'Alice', p: 'name', o: 'AliceName', file: '/x/a.ttl', line: 7 },
      { s: 'Alice', p: 'age', o: 'AliceAge', file: '/x/b.ttl', line: 12 },
      { s: 'Alice', p: 'email', o: 'AliceMail', file: '/x/b.ttl', line: 9 },
    ]);
    expect(anchorDefinitionSite(store, ex('Alice'), sourceRecords)).toEqual([
      { file: 'file:///x/a.ttl', line: 7 },
      { file: 'file:///x/b.ttl', line: 9 },
    ]);
  });

  it('resolves an untyped subject by its minimum annotated line (no rdf:type assumption)', () => {
    // No rdf:type triple on the anchor at all.
    const { store, sourceRecords } = buildSide([
      { s: 'Plain', p: 'label', o: 'PlainLabel', file: '/x/a.ttl', line: 20 },
      { s: 'Plain', p: 'note', o: 'PlainNote', file: '/x/a.ttl', line: 14 },
    ]);
    expect(anchorDefinitionSite(store, ex('Plain'), sourceRecords)).toEqual([
      { file: 'file:///x/a.ttl', line: 14 },
    ]);
  });

  it('propagates the pin (gitRef/gitSha) so the definition-site snippet reads the blob, not the working tree', () => {
    const { store, sourceRecords } = buildSide(
      [
        { s: 'Alice', p: 'name', o: 'AliceName', file: '/x/a.ttl', line: 7 },
        { s: 'Alice', p: 'age', o: 'AliceAge', file: '/x/a.ttl', line: 5 },
      ],
      { ref: 'v3.3.0', sha: 'f924df91f23208fcbdbc5eae56ff3085b3fd201f' },
    );
    expect(anchorDefinitionSite(store, ex('Alice'), sourceRecords)).toEqual([
      {
        file: 'file:///x/a.ttl',
        line: 5,
        gitRef: 'v3.3.0',
        gitSha: 'f924df91f23208fcbdbc5eae56ff3085b3fd201f',
      },
    ]);
  });

  it('returns an empty array when the anchor is absent from the store', () => {
    const { store, sourceRecords } = buildSide([
      { s: 'Bob', p: 'name', o: 'BobName', file: '/x/a.ttl', line: 3 },
    ]);
    expect(anchorDefinitionSite(store, ex('Alice'), sourceRecords)).toEqual([]);
  });

  it('returns an empty array when the sidecar has no records for the anchor (store carries no provenance)', () => {
    const store = new Store();
    store.addQuad(quad(namedNode(ex('Alice')), namedNode(ex('name')), namedNode(ex('AliceName'))));
    expect(anchorDefinitionSite(store, ex('Alice'), new Map())).toEqual([]);
  });

  it('anchors on a changed predicate line, not the earliest annotated line, when a changed-predicate set matches', () => {
    const { store, sourceRecords } = buildSide([
      { s: 'Prop', p: 'type', o: 'ObjectProperty', file: '/x/a.ttl', line: 5 },
      { s: 'Prop', p: 'rule', o: 'ShapeRule', file: '/x/a.ttl', line: 12 },
    ]);
    expect(
      anchorDefinitionSite(store, ex('Prop'), sourceRecords, new Set([ex('rule')])),
    ).toEqual([{ file: 'file:///x/a.ttl', line: 12 }]);
  });

  it('emits one focal record per matched predicate at that predicate\'s earliest line', () => {
    const { store, sourceRecords } = buildSide([
      { s: 'Prop', p: 'type', o: 'ObjectProperty', file: '/x/a.ttl', line: 5 },
      { s: 'Prop', p: 'rule', o: 'Rule2', file: '/x/a.ttl', line: 30 },
      { s: 'Prop', p: 'rule', o: 'Rule1', file: '/x/a.ttl', line: 12 },
      { s: 'Prop', p: 'label', o: 'Label', file: '/x/a.ttl', line: 20 },
    ]);
    expect(
      anchorDefinitionSite(
        store,
        ex('Prop'),
        sourceRecords,
        new Set([ex('rule'), ex('label')]),
      ),
    ).toEqual([
      { file: 'file:///x/a.ttl', line: 12 },
      { file: 'file:///x/a.ttl', line: 20 },
    ]);
  });

  it('falls back to the earliest annotated line when no direct predicate matches the changed set', () => {
    const { store, sourceRecords } = buildSide([
      { s: 'Prop', p: 'type', o: 'ObjectProperty', file: '/x/a.ttl', line: 5 },
      { s: 'Prop', p: 'rule', o: 'ShapeRule', file: '/x/a.ttl', line: 12 },
    ]);
    expect(
      anchorDefinitionSite(store, ex('Prop'), sourceRecords, new Set([ex('absent')])),
    ).toEqual([{ file: 'file:///x/a.ttl', line: 5 }]);
  });

  it('falls back to the earliest annotated line when the changed set is empty', () => {
    const { store, sourceRecords } = buildSide([
      { s: 'Prop', p: 'type', o: 'ObjectProperty', file: '/x/a.ttl', line: 5 },
      { s: 'Prop', p: 'rule', o: 'ShapeRule', file: '/x/a.ttl', line: 12 },
    ]);
    expect(
      anchorDefinitionSite(store, ex('Prop'), sourceRecords, new Set()),
    ).toEqual([{ file: 'file:///x/a.ttl', line: 5 }]);
  });

  it('falls back to the earliest annotated line when the matched predicate records carry no line', () => {
    const { store, sourceRecords } = buildSide([
      { s: 'Prop', p: 'type', o: 'ObjectProperty', file: '/x/a.ttl', line: 5 },
      { s: 'Prop', p: 'rule', o: 'ShapeRule', file: '/x/a.ttl' },
    ]);
    expect(
      anchorDefinitionSite(store, ex('Prop'), sourceRecords, new Set([ex('rule')])),
    ).toEqual([{ file: 'file:///x/a.ttl', line: 5 }]);
  });

  it('carries the pin (gitRef/gitSha) on a focal record', () => {
    const { store, sourceRecords } = buildSide(
      [
        { s: 'Prop', p: 'type', o: 'ObjectProperty', file: '/x/a.ttl', line: 5 },
        { s: 'Prop', p: 'rule', o: 'ShapeRule', file: '/x/a.ttl', line: 12 },
      ],
      { ref: 'v3.3.0', sha: 'f924df91f23208fcbdbc5eae56ff3085b3fd201f' },
    );
    expect(
      anchorDefinitionSite(store, ex('Prop'), sourceRecords, new Set([ex('rule')])),
    ).toEqual([
      {
        file: 'file:///x/a.ttl',
        line: 12,
        gitRef: 'v3.3.0',
        gitSha: 'f924df91f23208fcbdbc5eae56ff3085b3fd201f',
      },
    ]);
  });
});
