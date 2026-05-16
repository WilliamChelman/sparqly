import { resolve } from 'node:path';
import { DataFactory, Parser, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import { diffCanonicalStatements, diffStores } from './diff';
import type { RdfDiffWithSourcesResult } from './diff';
import { groupRdfDiffByEntity } from './group-rdf-diff-by-entity';
import type { Hunk } from './group-rdf-diff-by-entity';
import { parseRdfFile } from '../engine';
import {
  buildSourceRecord,
  buildSourceRecordSidecar,
  DEFAULT_ANNOTATION_PREDICATE_IRIS,
  type SidecarLoaderRecord,
  type SourceRecordSidecar,
} from '../sources';

const ex = (iri: string): string => `http://example.org/${iri}`;
const t = (iri: string): string => `<${ex(iri)}>`;
const triple = (s: string, p: string, o: string): string =>
  `${t(s)} ${t(p)} ${t(o)} .`;

function storeOf(nquads: string): Store {
  const parser = new Parser({ format: 'application/n-quads' });
  const store = new Store();
  store.addQuads(parser.parse(nquads));
  return store;
}

function emptyResult(
  left: readonly string[],
  right: readonly string[],
): RdfDiffWithSourcesResult {
  return {
    ...diffCanonicalStatements(left, right),
    sourceRecords: { left: new Map(), right: new Map() },
  };
}

interface RecordShape { file: string; line?: number; endLine?: number; }
function withSourceRecords(
  base: RdfDiffWithSourcesResult,
  recs: {
    left?: ReadonlyArray<readonly [string, ReadonlyArray<RecordShape>]>;
    right?: ReadonlyArray<readonly [string, ReadonlyArray<RecordShape>]>;
  },
): RdfDiffWithSourcesResult {
  const left = new Map<string, RecordShape[]>();
  const right = new Map<string, RecordShape[]>();
  for (const [k, v] of recs.left ?? []) left.set(k, v.map((r) => ({ ...r })));
  for (const [k, v] of recs.right ?? []) right.set(k, v.map((r) => ({ ...r })));
  return { ...base, sourceRecords: { left, right } };
}

describe('groupRdfDiffByEntity — named-entity anchoring', () => {
  it('groups two changed quads sharing a named subject under one hunk anchored on that subject IRI', () => {
    const left = [
      triple('a', 'p', 'b1'),
      triple('a', 'q', 'c1'),
    ];
    const right = [
      triple('a', 'p', 'b2'),
      triple('a', 'q', 'c2'),
    ];
    const diff = emptyResult(left, right);

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: storeOf(left.join('\n') + '\n') },
      right: { store: storeOf(right.join('\n') + '\n') },
    });

    expect(hunked.totals).toEqual(diff.totals);
    expect(hunked.hunks).toHaveLength(1);
    expect(hunked.hunks[0].anchor).toBe(ex('a'));
    // Two `-` plus two `+` lines.
    expect(hunked.hunks[0].removed).toBe(2);
    expect(hunked.hunks[0].added).toBe(2);
    expect(hunked.hunks[0].lines).toHaveLength(4);
  });

  it('within a hunk, lines are sorted by (subject-path, predicate); `-` precedes `+` for the same (identity, predicate) cluster', () => {
    // Two single-value flips on the same subject, plus a solo add on a
    // lex-later predicate. The flip on `p` must render `-/+` adjacent and
    // come before the solo `+` on `q`.
    const left = [triple('a', 'p', 'b1')];
    const right = [triple('a', 'p', 'b2'), triple('a', 'q', 'c')];
    const diff = emptyResult(left, right);

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: storeOf(left.join('\n') + '\n') },
      right: { store: storeOf(right.join('\n') + '\n') },
    });

    expect(hunked.hunks).toHaveLength(1);
    const lines = hunked.hunks[0].lines;
    expect(lines.map((l) => `${l.side} ${l.predicate} ${l.object}`)).toEqual([
      `- ${ex('p')} <${ex('b1')}>`,
      `+ ${ex('p')} <${ex('b2')}>`,
      `+ ${ex('q')} <${ex('c')}>`,
    ]);
  });

  it('per-hunk source records dedup by (file,line) per side, drawing left records on `-` lines and right on `+`', () => {
    const left = [triple('a', 'p', 'b1'), triple('a', 'q', 'c1')];
    const right = [triple('a', 'p', 'b2'), triple('a', 'q', 'c2')];
    const base = emptyResult(left, right);
    const diff = withSourceRecords(base, {
      left: [
        // Same (file, line) attached to two changed left lines → one chip.
        [triple('a', 'p', 'b1'), [{ file: 'file:///x/a.ttl', line: 7 }]],
        [triple('a', 'q', 'c1'), [{ file: 'file:///x/a.ttl', line: 7 }]],
      ],
      right: [
        [triple('a', 'p', 'b2'), [{ file: 'file:///x/b.ttl', line: 3 }]],
        [triple('a', 'q', 'c2'), [{ file: 'file:///x/b.ttl', line: 9 }]],
      ],
    });

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: storeOf(left.join('\n') + '\n') },
      right: { store: storeOf(right.join('\n') + '\n') },
    });

    expect(hunked.hunks).toHaveLength(1);
    expect(hunked.hunks[0].sourceRecords.left).toEqual([
      { file: 'file:///x/a.ttl', line: 7 },
    ]);
    expect(hunked.hunks[0].sourceRecords.right).toEqual([
      { file: 'file:///x/b.ttl', line: 3 },
      { file: 'file:///x/b.ttl', line: 9 },
    ]);
  });

  it('propagates `endLine` on per-hunk source records (multi-line object span)', () => {
    // Stand-in for a triple-quoted multi-line literal: the asserted quad
    // carries an annotation record whose file is set, line=11 (opening
    // quote), endLine=16 (closing quote line).
    const left = [triple('a', 'p', 'b1')];
    const right = [triple('a', 'p', 'b2')];
    const base = emptyResult(left, right);
    const diff = withSourceRecords(base, {
      right: [
        [
          triple('a', 'p', 'b2'),
          [{ file: 'file:///x/a.ttl', line: 11, endLine: 16 }],
        ],
      ],
    });
    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: storeOf(left.join('\n') + '\n') },
      right: { store: storeOf(right.join('\n') + '\n') },
    });
    expect(hunked.hunks[0].sourceRecords.right).toEqual([
      { file: 'file:///x/a.ttl', line: 11, endLine: 16 },
    ]);
  });

  it("attaches `rdfType` from rdf:type on the side that owns the entity (right when present, falls back to left)", () => {
    const RDF_TYPE = '<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>';
    const SHAPE = '<http://www.w3.org/ns/shacl#NodeShape>';
    const leftStoreNquads =
      `${t('a')} ${RDF_TYPE} ${SHAPE} .\n${triple('a', 'p', 'b1')}\n`;
    const rightStoreNquads =
      `${t('a')} ${RDF_TYPE} ${SHAPE} .\n${triple('a', 'p', 'b2')}\n`;
    const left = [triple('a', 'p', 'b1')];
    const right = [triple('a', 'p', 'b2')];
    const diff = emptyResult(left, right);

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: storeOf(leftStoreNquads) },
      right: { store: storeOf(rightStoreNquads) },
    });

    expect(hunked.hunks[0].rdfType).toBe('http://www.w3.org/ns/shacl#NodeShape');
  });

  it('produces one hunk per distinct named subject, sorted lex by anchor IRI', () => {
    const left = [triple('z', 'p', 'b1'), triple('a', 'p', 'b1')];
    const right = [triple('z', 'p', 'b2'), triple('a', 'p', 'b2')];
    const diff = emptyResult(left, right);

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: storeOf(left.join('\n') + '\n') },
      right: { store: storeOf(right.join('\n') + '\n') },
    });

    expect(hunked.hunks.map((h) => h.anchor)).toEqual([ex('a'), ex('z')]);
  });
});

describe('groupRdfDiffByEntity — blank-node absorption into named parent', () => {
  const SH = 'http://www.w3.org/ns/shacl#';
  const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
  const EX = 'http://example.org/';

  it('absorbs a bnode subject reachable from a single named parent into that parent\'s hunk (no orphan bnode hunk)', async () => {
    // ex:Shape sh:property _:b ; _:b sh:datatype xsd:integer
    // Datatype changes between sides; the bnode is the same shape per side.
    const leftNquads =
      `<${EX}Shape> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Shape> <${SH}property> _:b1 .\n` +
      `_:b1 <${SH}datatype> <http://www.w3.org/2001/XMLSchema#decimal> .\n`;
    const rightNquads =
      `<${EX}Shape> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Shape> <${SH}property> _:b1 .\n` +
      `_:b1 <${SH}datatype> <http://www.w3.org/2001/XMLSchema#integer> .\n`;
    const leftStore = storeOf(leftNquads);
    const rightStore = storeOf(rightNquads);
    const diff = await diffStores({ store: leftStore }, { store: rightStore });

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: leftStore },
      right: { store: rightStore },
    });

    expect(hunked.hunks.map((h) => h.anchor)).toEqual([`${EX}Shape`]);
    const hunk = hunked.hunks[0];
    expect(hunk.removed).toBe(1);
    expect(hunk.added).toBe(1);
    // The two changed `_:b1 sh:datatype ...` quads land under the named parent.
    expect(hunk.lines.map((l) => `${l.side} ${l.predicate}`)).toEqual([
      `- ${SH}datatype`,
      `+ ${SH}datatype`,
    ]);
  });

  it('walks through a chain of bnodes (bnode-through-bnode) to reach the named parent', async () => {
    // ex:Shape sh:property _:outer ; _:outer sh:property _:inner ; _:inner sh:datatype xsd:int
    const leftNquads =
      `<${EX}Shape> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Shape> <${SH}property> _:outer .\n` +
      `_:outer <${SH}property> _:inner .\n` +
      `_:inner <${SH}datatype> <http://www.w3.org/2001/XMLSchema#decimal> .\n`;
    const rightNquads =
      `<${EX}Shape> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Shape> <${SH}property> _:outer .\n` +
      `_:outer <${SH}property> _:inner .\n` +
      `_:inner <${SH}datatype> <http://www.w3.org/2001/XMLSchema#integer> .\n`;
    const leftStore = storeOf(leftNquads);
    const rightStore = storeOf(rightNquads);
    const diff = await diffStores({ store: leftStore }, { store: rightStore });

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: leftStore },
      right: { store: rightStore },
    });

    expect(hunked.hunks.map((h) => h.anchor)).toEqual([`${EX}Shape`]);
    expect(hunked.hunks[0].removed).toBe(1);
    expect(hunked.hunks[0].added).toBe(1);
  });

  it('uses sh:path value as identity for cross-side pairing of bnodes hanging off the same parent+predicate', async () => {
    // Two PropertyShape bnodes per side, distinct sh:path. `foo` keeps sh:path
    // but flips sh:datatype; `bar` is unchanged. The flip on `foo` must pair
    // -/+ adjacent under the same parent.
    const leftNquads =
      `<${EX}Shape> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Shape> <${SH}property> _:l1 .\n` +
      `<${EX}Shape> <${SH}property> _:l2 .\n` +
      `_:l1 <${SH}path> <${EX}foo> .\n` +
      `_:l1 <${SH}datatype> <http://www.w3.org/2001/XMLSchema#decimal> .\n` +
      `_:l2 <${SH}path> <${EX}bar> .\n` +
      `_:l2 <${SH}datatype> <http://www.w3.org/2001/XMLSchema#string> .\n`;
    const rightNquads =
      `<${EX}Shape> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Shape> <${SH}property> _:r1 .\n` +
      `<${EX}Shape> <${SH}property> _:r2 .\n` +
      `_:r1 <${SH}path> <${EX}foo> .\n` +
      `_:r1 <${SH}datatype> <http://www.w3.org/2001/XMLSchema#integer> .\n` +
      `_:r2 <${SH}path> <${EX}bar> .\n` +
      `_:r2 <${SH}datatype> <http://www.w3.org/2001/XMLSchema#string> .\n`;
    const leftStore = storeOf(leftNquads);
    const rightStore = storeOf(rightNquads);
    const diff = await diffStores({ store: leftStore }, { store: rightStore });

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: leftStore },
      right: { store: rightStore },
    });

    expect(hunked.hunks).toHaveLength(1);
    const hunk = hunked.hunks[0];
    expect(hunk.anchor).toBe(`${EX}Shape`);
    // Lines for the same sh:path identity sort adjacent: `-` precedes `+`.
    const datatypeLines = hunk.lines.filter(
      (l) => l.predicate === `${SH}datatype`,
    );
    expect(datatypeLines.map((l) => l.side)).toEqual(['-', '+']);
    // Both `-` and `+` should agree on `subjectPath` (i.e. share the sh:path
    // identity) so the comparator clusters them.
    expect(datatypeLines[0].subjectPath).toBe(datatypeLines[1].subjectPath);
  });

  it('falls back to the canonical bnode label for identity when sh:path is absent — and never pairs by label across sides', async () => {
    // No sh:path. Two separate sh:property bnodes per side, both flipping
    // sh:datatype. They must NOT pair across sides: each side renders its
    // own `-`/`+` independently.
    const leftNquads =
      `<${EX}Shape> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Shape> <${SH}property> _:l1 .\n` +
      `_:l1 <${SH}datatype> <http://www.w3.org/2001/XMLSchema#decimal> .\n`;
    const rightNquads =
      `<${EX}Shape> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Shape> <${SH}property> _:r1 .\n` +
      `_:r1 <${SH}datatype> <http://www.w3.org/2001/XMLSchema#integer> .\n`;
    const leftStore = storeOf(leftNquads);
    const rightStore = storeOf(rightNquads);
    const diff = await diffStores({ store: leftStore }, { store: rightStore });

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: leftStore },
      right: { store: rightStore },
    });

    expect(hunked.hunks).toHaveLength(1);
    const hunk = hunked.hunks[0];
    expect(hunk.anchor).toBe(`${EX}Shape`);
    // The diff has 4 changed quads (the parent sh:property triples flip their
    // bnode object, plus sh:datatype flips). Lines exist for each. The
    // `subjectPath` for the `-` and `+` sh:datatype lines must DIFFER so they
    // do not collapse into a paired cluster (no cross-side bnode-label
    // pairing).
    const datatypeLines = hunk.lines.filter(
      (l) => l.predicate === `${SH}datatype`,
    );
    expect(datatypeLines).toHaveLength(2);
    expect(datatypeLines[0].subjectPath).not.toBe(datatypeLines[1].subjectPath);
  });
});

describe('groupRdfDiffByEntity — multi-parent bnode duplication', () => {
  const SH = 'http://www.w3.org/ns/shacl#';
  const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
  const EX = 'http://example.org/';

  it('duplicates a changed bnode-line under each named parent that reaches it (one HunkLine per parent, deterministic by anchor)', async () => {
    // Two NodeShapes share a single PropertyShape blank node. The shared
    // bnode's sh:datatype flips between sides. The reader looking at either
    // parent shape should see the change in full, so the change is duplicated
    // under both parent hunks.
    const leftNquads =
      `<${EX}A> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}B> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}A> <${SH}property> _:shared .\n` +
      `<${EX}B> <${SH}property> _:shared .\n` +
      `_:shared <${SH}path> <${EX}foo> .\n` +
      `_:shared <${SH}datatype> <http://www.w3.org/2001/XMLSchema#decimal> .\n`;
    const rightNquads =
      `<${EX}A> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}B> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}A> <${SH}property> _:shared .\n` +
      `<${EX}B> <${SH}property> _:shared .\n` +
      `_:shared <${SH}path> <${EX}foo> .\n` +
      `_:shared <${SH}datatype> <http://www.w3.org/2001/XMLSchema#integer> .\n`;
    const leftStore = storeOf(leftNquads);
    const rightStore = storeOf(rightNquads);
    const diff = await diffStores({ store: leftStore }, { store: rightStore });

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: leftStore },
      right: { store: rightStore },
    });

    expect(hunked.hunks.map((h) => h.anchor)).toEqual([`${EX}A`, `${EX}B`]);
    // Each parent's hunk must carry both -/+ lines for the shared bnode.
    for (const hunk of hunked.hunks) {
      expect(hunk.removed).toBe(1);
      expect(hunk.added).toBe(1);
      expect(hunk.lines.map((l) => `${l.side} ${l.predicate}`)).toEqual([
        `- ${SH}datatype`,
        `+ ${SH}datatype`,
      ]);
    }
  });
});

describe('groupRdfDiffByEntity — orphan bnode trees (no named parent on either side)', () => {
  const RDF_FIRST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
  const RDF_REST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest';
  const RDF_NIL = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil';
  const EX = 'http://example.org/';

  it('right-only orphan tree: anchors on the orphan root and routes the hunk to `added` with `orphan` set', async () => {
    const leftNquads = '';
    const rightNquads =
      `_:head <${RDF_FIRST}> <${EX}a> .\n` +
      `_:head <${RDF_REST}> <${RDF_NIL}> .\n`;
    const leftStore = storeOf(leftNquads);
    const rightStore = storeOf(rightNquads);
    const diff = await diffStores({ store: leftStore }, { store: rightStore });

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: leftStore },
      right: { store: rightStore },
    });

    expect(hunked.hunks).toHaveLength(1);
    const hunk = hunked.hunks[0];
    expect(hunk.orphan).toBe(true);
    expect(hunk.state).toBe('added');
    expect(hunk.anchor.startsWith('_:')).toBe(true);
    expect(hunk.added).toBe(2);
    expect(hunk.removed).toBe(0);
    expect(hunk.lines.every((l) => l.side === '+')).toBe(true);
  });

  it('orphan trees on both sides sharing a canonical bnode label: each side produces its own hunk; the left-only (removed) sorts before the right-only (added) via the `state` tie-break', async () => {
    // A left orphan list AND a right orphan list. The left tree is entirely
    // gone and a different right tree appears. Their canonical bnode labels
    // collide on the same string (`c14n0` per-side), so the only thing
    // separating the two hunks in the sorted list is the `state` tie-break:
    // `removed` < `added`.
    const leftNquads =
      `_:l1 <${RDF_FIRST}> <${EX}a> .\n` +
      `_:l1 <${RDF_REST}> <${RDF_NIL}> .\n`;
    const rightNquads =
      `_:r1 <${RDF_FIRST}> <${EX}b> .\n` +
      `_:r1 <${RDF_REST}> <${RDF_NIL}> .\n`;
    const leftStore = storeOf(leftNquads);
    const rightStore = storeOf(rightNquads);
    const diff = await diffStores({ store: leftStore }, { store: rightStore });

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: leftStore },
      right: { store: rightStore },
    });

    expect(hunked.hunks).toHaveLength(2);
    expect(hunked.hunks.map((h) => h.state)).toEqual(['removed', 'added']);
    expect(hunked.hunks.every((h) => h.orphan === true)).toBe(true);
    expect(hunked.hunks[0].lines.every((l) => l.side === '-')).toBe(true);
    expect(hunked.hunks[1].lines.every((l) => l.side === '+')).toBe(true);
  });

  it('left-only orphan tree: synthesizes a hunk anchored on the orphan-root canonical bnode label, marks it `orphan`, and sets `state` to `removed`', async () => {
    // An RDF list head with no named parent on either side: present only on
    // the left, deleted on the right. Every changed quad about the list lives
    // in `diff.removed`; no named ancestor exists, so the algorithm must
    // synthesize an anchor from the orphan tree's root canonical bnode label
    // rather than silently drop the changes.
    const leftNquads =
      `_:head <${RDF_FIRST}> <${EX}a> .\n` +
      `_:head <${RDF_REST}> <${RDF_NIL}> .\n`;
    const rightNquads = '';
    const leftStore = storeOf(leftNquads);
    const rightStore = storeOf(rightNquads);
    const diff = await diffStores({ store: leftStore }, { store: rightStore });

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: leftStore },
      right: { store: rightStore },
    });

    expect(hunked.hunks).toHaveLength(1);
    const hunk = hunked.hunks[0];
    expect(hunk.orphan).toBe(true);
    expect(hunk.state).toBe('removed');
    // Anchor is the canonical bnode label rendered with the `_:` prefix.
    expect(hunk.anchor.startsWith('_:')).toBe(true);
    // Both changed quads land inside this orphan hunk.
    expect(hunk.removed).toBe(2);
    expect(hunk.added).toBe(0);
    expect(hunk.lines).toHaveLength(2);
    expect(hunk.lines.every((l) => l.side === '-')).toBe(true);
  });
});

describe('groupRdfDiffByEntity — RDF list compaction', () => {
  const RDF_FIRST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
  const RDF_REST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest';
  const RDF_NIL = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil';
  const EX = 'http://example.org/';

  it('collapses a changed rdf:list under a named anchor into one `-`/`+` line per side carrying serialized list items', async () => {
    // ex:a ex:friends ( ex:Bob ex:Carl )       -- left
    // ex:a ex:friends ( ex:Bob ex:Carl ex:Donald ) -- right
    const leftNquads =
      `<${EX}a> <${EX}friends> _:l1 .\n` +
      `_:l1 <${RDF_FIRST}> <${EX}Bob> .\n` +
      `_:l1 <${RDF_REST}> _:l2 .\n` +
      `_:l2 <${RDF_FIRST}> <${EX}Carl> .\n` +
      `_:l2 <${RDF_REST}> <${RDF_NIL}> .\n`;
    const rightNquads =
      `<${EX}a> <${EX}friends> _:r1 .\n` +
      `_:r1 <${RDF_FIRST}> <${EX}Bob> .\n` +
      `_:r1 <${RDF_REST}> _:r2 .\n` +
      `_:r2 <${RDF_FIRST}> <${EX}Carl> .\n` +
      `_:r2 <${RDF_REST}> _:r3 .\n` +
      `_:r3 <${RDF_FIRST}> <${EX}Donald> .\n` +
      `_:r3 <${RDF_REST}> <${RDF_NIL}> .\n`;
    const leftStore = storeOf(leftNquads);
    const rightStore = storeOf(rightNquads);
    const diff = await diffStores(
      { store: leftStore },
      { store: rightStore },
    );

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: leftStore },
      right: { store: rightStore },
    });

    expect(hunked.hunks).toHaveLength(1);
    const hunk = hunked.hunks[0];
    expect(hunk.anchor).toBe(`${EX}a`);

    // No raw list-spine triples should remain in the hunk lines after
    // compaction — they are absorbed into the synthetic compact line.
    expect(hunk.lines.some((l) => l.predicate === RDF_FIRST)).toBe(false);
    expect(hunk.lines.some((l) => l.predicate === RDF_REST)).toBe(false);

    const friends = hunk.lines.filter((l) => l.predicate === `${EX}friends`);
    expect(friends).toHaveLength(2);

    const minus = friends.find((l) => l.side === '-');
    const plus = friends.find((l) => l.side === '+');
    expect(minus?.listItems).toEqual([`<${EX}Bob>`, `<${EX}Carl>`]);
    expect(plus?.listItems).toEqual([
      `<${EX}Bob>`,
      `<${EX}Carl>`,
      `<${EX}Donald>`,
    ]);
  });
});

describe('groupRdfDiffByEntity — RDF list compaction edge cases', () => {
  const RDF_FIRST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
  const RDF_REST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest';
  const EX = 'http://example.org/';

  it('compacts a list whose parent triple is identical between sides (only the spine differs) by fabricating a single compact line per side', async () => {
    // Mirrors the diff-01.ttl vs diff-02.ttl friends scenario: both sides
    // share <Alice> <friends> ( Bob, Carl ... ) where the head bnode
    // canonicalizes to the SAME label on both sides under RDFC-1.0 because
    // both lists share the same prefix (Bob, Carl, ...). The parent triple
    // is therefore not in the diff — only spine `<rdf:rest>` triples are.
    // Compaction must still synthesize one compact line per side, NOT use a
    // spine triple as its entry point (which would yield `rdf:rest ( ... )`).
    const leftPath = resolve(__dirname, '../../../../../test/data/diffs/diff-01.ttl');
    const rightPath = resolve(__dirname, '../../../../../test/data/diffs/diff-02.ttl');
    const left = await parseRdfFile(leftPath);
    const right = await parseRdfFile(rightPath);
    const leftStore = new Store();
    leftStore.addQuads(left.records.map((r) => r.quad));
    const rightStore = new Store();
    rightStore.addQuads(right.records.map((r) => r.quad));
    const diff = await diffStores(
      { store: leftStore },
      { store: rightStore },
    );

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: leftStore },
      right: { store: rightStore },
    });

    // No compact line may carry rdf:first or rdf:rest as its predicate —
    // that always indicates a spine triple was misused as the compaction entry.
    for (const hunk of hunked.hunks) {
      for (const line of hunk.lines) {
        if (line.listItems !== undefined) {
          expect(line.predicate).not.toBe(RDF_FIRST);
          expect(line.predicate).not.toBe(RDF_REST);
        }
      }
    }

    // And no raw spine triple should leak through after compaction.
    for (const hunk of hunked.hunks) {
      expect(hunk.lines.some((l) => l.predicate === RDF_FIRST)).toBe(false);
      expect(hunk.lines.some((l) => l.predicate === RDF_REST)).toBe(false);
    }

    // The Alice hunk should expose one `-` and one `+` friends compact line.
    const alice = hunked.hunks.find((h) => h.anchor === `${EX}Alice`);
    expect(alice).toBeDefined();
    const friends = (alice as Hunk).lines.filter(
      (l) => l.predicate === `${EX}friends`,
    );
    expect(friends).toHaveLength(2);
    const minus = friends.find((l) => l.side === '-');
    const plus = friends.find((l) => l.side === '+');
    expect(minus?.listItems).toEqual([`<${EX}Bob>`, `<${EX}Carl>`]);
    expect(plus?.listItems).toEqual([
      `<${EX}Bob>`,
      `<${EX}Carl>`,
      `<${EX}Donald>`,
    ]);
  });
});

describe('groupRdfDiffByEntity — one anchor-sorted list with `state` per hunk', () => {
  const SH = 'http://www.w3.org/ns/shacl#';
  const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
  const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
  const EX = 'http://example.org/';

  it('returns one list sorted purely by anchor — a left-only (removed) and a changed-on-both-sides entity interleave by IRI, not by state', async () => {
    // Bar exists only on the left → removed; sorts before Foo by IRI even
    // though Foo is `changed`. There is no changed-then-removed bucketing.
    const leftNquads =
      `<${EX}Foo> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Foo> <${RDFS}label> "Foo v1" .\n` +
      `<${EX}Bar> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Bar> <${RDFS}label> "Bar v1" .\n`;
    const rightNquads =
      `<${EX}Foo> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Foo> <${RDFS}label> "Foo v2" .\n`;

    const leftStore = storeOf(leftNquads);
    const rightStore = storeOf(rightNquads);
    const diff = await diffStores({ store: leftStore }, { store: rightStore });

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: leftStore },
      right: { store: rightStore },
    });

    expect(hunked.hunks.map((h) => [h.anchor, h.state])).toEqual([
      [`${EX}Bar`, 'removed'],
      [`${EX}Foo`, 'changed'],
    ]);
  });

  it('a right-only entity gets `state` `added` and sorts into the list by its anchor', async () => {
    const leftNquads =
      `<${EX}Foo> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Foo> <${RDFS}label> "Foo v1" .\n`;
    const rightNquads =
      `<${EX}Foo> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Foo> <${RDFS}label> "Foo v1" .\n` +
      `<${EX}New> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}New> <${RDFS}label> "New" .\n`;

    const leftStore = storeOf(leftNquads);
    const rightStore = storeOf(rightNquads);
    const diff = await diffStores({ store: leftStore }, { store: rightStore });

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: leftStore },
      right: { store: rightStore },
    });

    expect(hunked.hunks.map((h) => h.anchor)).toEqual([`${EX}New`]);
    expect(hunked.hunks[0].state).toBe('added');
  });

  it('the body of a single-side hunk renders only the triples in the diff (no full entity dump) and counts reflect those', async () => {
    // Bar is removed entirely on the right. The diff carries every triple about
    // Bar as `-` lines; the body must contain exactly those (not invent extra
    // lines, not drop any).
    const leftNquads =
      `<${EX}Foo> <${RDFS}label> "Foo v1" .\n` +
      `<${EX}Bar> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Bar> <${RDFS}label> "Bar v1" .\n` +
      `<${EX}Bar> <${RDFS}comment> "ext" .\n`;
    const rightNquads = `<${EX}Foo> <${RDFS}label> "Foo v1" .\n`;

    const leftStore = storeOf(leftNquads);
    const rightStore = storeOf(rightNquads);
    const diff = await diffStores({ store: leftStore }, { store: rightStore });

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: leftStore },
      right: { store: rightStore },
    });

    const hunk = hunked.hunks.find((h) => h.anchor === `${EX}Bar`);
    expect(hunk).toBeDefined();
    expect((hunk as Hunk).state).toBe('removed');
    expect((hunk as Hunk).added).toBe(0);
    // The diff has 3 quads about Bar; all three should appear as `-` lines and
    // nothing else.
    expect((hunk as Hunk).removed).toBe(3);
    expect((hunk as Hunk).lines).toHaveLength(3);
    expect((hunk as Hunk).lines.every((l) => l.side === '-')).toBe(true);
  });

  it('hunks are sorted lex by anchor IRI regardless of insertion order or state', async () => {
    // Build entries in lex-reverse insertion order to confirm the comparator
    // (not the insertion order) drives output.
    const leftNquads =
      `<${EX}c> <${RDFS}label> "c1" .\n` +
      `<${EX}b> <${RDFS}label> "b1" .\n` +
      `<${EX}a> <${RDFS}label> "a1" .\n`;
    const rightNquads =
      `<${EX}c> <${RDFS}label> "c2" .\n` +
      `<${EX}b> <${RDFS}label> "b2" .\n` +
      `<${EX}a> <${RDFS}label> "a2" .\n`;

    const leftStore = storeOf(leftNquads);
    const rightStore = storeOf(rightNquads);
    const diff = await diffStores({ store: leftStore }, { store: rightStore });

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: leftStore },
      right: { store: rightStore },
    });

    expect(hunked.hunks.map((h) => h.anchor)).toEqual([
      `${EX}a`,
      `${EX}b`,
      `${EX}c`,
    ]);
  });
});

describe('groupRdfDiffByEntity — anchorSource (anchor definition site)', () => {
  const { namedNode, quad } = DataFactory;

  interface AnnEntry {
    s: string;
    p: string;
    o: string;
    file: string;
    line?: number;
  }

  // Mirrors the "user declared explicit `annotateSource`" production case
  // (ADR-0032): the loader emits a sidecar that drives diff's source-record
  // map, and the explicit transform also writes RDF-star annotations into the
  // store so `anchorDefinitionSite` can resolve the anchor's definition site.
  function annotatedSide(entries: ReadonlyArray<AnnEntry>): {
    store: Store;
    sourceRecords: SourceRecordSidecar;
  } {
    const store = new Store();
    const perFile = new Map<string, SidecarLoaderRecord[]>();
    for (const e of entries) {
      const asserted = quad(namedNode(ex(e.s)), namedNode(ex(e.p)), namedNode(ex(e.o)));
      store.addQuad(asserted);
      store.addQuads(
        buildSourceRecord({
          asserted,
          filePath: e.file,
          line: e.line,
          predicates: DEFAULT_ANNOTATION_PREDICATE_IRIS,
        }),
      );
      let bucket = perFile.get(e.file);
      if (bucket === undefined) {
        bucket = [];
        perFile.set(e.file, bucket);
      }
      const rec: SidecarLoaderRecord = { quad: asserted };
      if (e.line !== undefined) rec.line = e.line;
      bucket.push(rec);
    }
    return { store, sourceRecords: buildSourceRecordSidecar(perFile) };
  }

  it('a changed hunk where a property was only added to an existing subject: sourceRecords.left is empty and anchorSource.left points at the subject\'s earliest annotated line per left file', async () => {
    const left = annotatedSide([
      { s: 'Alice', p: 'name', o: 'A', file: '/x/a.ttl', line: 5 },
    ]);
    const right = annotatedSide([
      { s: 'Alice', p: 'name', o: 'A', file: '/x/a.ttl', line: 5 },
      { s: 'Alice', p: 'nick', o: 'Al', file: '/x/b.ttl', line: 9 },
    ]);
    const diff = await diffStores(left, right);
    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: left.store },
      right: { store: right.store },
    });

    expect(hunked.hunks).toHaveLength(1);
    const hunk = hunked.hunks[0];
    expect(hunk.anchor).toBe(ex('Alice'));
    expect(hunk.state).toBe('changed');
    expect(hunk.sourceRecords.left).toEqual([]);
    expect(hunk.sourceRecords.right).toEqual([{ file: 'file:///x/b.ttl', line: 9 }]);
    expect(hunk.anchorSource).toEqual({
      left: [{ file: 'file:///x/a.ttl', line: 5 }],
      right: [],
    });
  });

  it('mirror: a changed hunk whose changes are removal-only from a still-existing subject populates anchorSource.right symmetrically', async () => {
    const left = annotatedSide([
      { s: 'Alice', p: 'name', o: 'A', file: '/x/a.ttl', line: 5 },
      { s: 'Alice', p: 'nick', o: 'Al', file: '/x/a.ttl', line: 6 },
    ]);
    const right = annotatedSide([
      { s: 'Alice', p: 'name', o: 'A', file: '/x/b.ttl', line: 3 },
    ]);
    const diff = await diffStores(left, right);
    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: left.store },
      right: { store: right.store },
    });

    expect(hunked.hunks).toHaveLength(1);
    const hunk = hunked.hunks[0];
    expect(hunk.state).toBe('changed');
    expect(hunk.sourceRecords.right).toEqual([]);
    expect(hunk.anchorSource).toEqual({
      left: [],
      right: [{ file: 'file:///x/b.ttl', line: 3 }],
    });
  });

  it('added / removed hunks carry no anchorSource (the subject genuinely does not exist on the other side)', async () => {
    const left = annotatedSide([
      { s: 'Gone', p: 'name', o: 'G', file: '/x/a.ttl', line: 2 },
    ]);
    const right = annotatedSide([
      { s: 'Fresh', p: 'name', o: 'F', file: '/x/b.ttl', line: 4 },
    ]);
    const diff = await diffStores(left, right);
    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: left.store },
      right: { store: right.store },
    });

    expect(hunked.hunks.map((h) => [h.anchor, h.state])).toEqual([
      [ex('Fresh'), 'added'],
      [ex('Gone'), 'removed'],
    ]);
    for (const hunk of hunked.hunks) {
      expect(hunk.anchorSource).toBeUndefined();
    }
  });

  it('a changed hunk where both sides contributed changed-line source records gets no anchorSource', async () => {
    const left = annotatedSide([
      { s: 'Alice', p: 'name', o: 'Old', file: '/x/a.ttl', line: 5 },
    ]);
    const right = annotatedSide([
      { s: 'Alice', p: 'name', o: 'New', file: '/x/b.ttl', line: 5 },
    ]);
    const diff = await diffStores(left, right);
    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: left.store },
      right: { store: right.store },
    });

    expect(hunked.hunks).toHaveLength(1);
    const hunk = hunked.hunks[0];
    expect(hunk.state).toBe('changed');
    expect(hunk.sourceRecords.left.length).toBeGreaterThan(0);
    expect(hunk.sourceRecords.right.length).toBeGreaterThan(0);
    expect(hunk.anchorSource).toBeUndefined();
  });
});

describe('groupRdfDiffByEntity — golden HunkedRdfDiff JSON on a small SHACL-style fixture', () => {
  it('pins the JSON shape end-to-end through diffStores for two NodeShapes whose `rdfs:label` changed', async () => {
    const SH = 'http://www.w3.org/ns/shacl#';
    const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
    const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
    const EX = 'http://example.org/';

    const leftNquads =
      `<${EX}Foo> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Foo> <${RDFS}label> "Foo v1" .\n` +
      `<${EX}Bar> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Bar> <${RDFS}label> "Bar v1" .\n`;
    const rightNquads =
      `<${EX}Foo> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Foo> <${RDFS}label> "Foo v2" .\n` +
      `<${EX}Bar> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Bar> <${RDFS}label> "Bar v1" .\n`;

    const leftStore = storeOf(leftNquads);
    const rightStore = storeOf(rightNquads);
    const diff = await diffStores(
      { store: leftStore },
      { store: rightStore },
    );

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: leftStore },
      right: { store: rightStore },
    });

    expect(JSON.parse(JSON.stringify(hunked))).toEqual({
      totals: { left: 4, right: 4 },
      hunks: [
        {
          anchor: `${EX}Foo`,
          rdfType: `${SH}NodeShape`,
          state: 'changed',
          removed: 1,
          added: 1,
          lines: [
            {
              side: '-',
              subjectPath: `${EX}Foo`,
              predicate: `${RDFS}label`,
              object: '"Foo v1"',
              nquad: `<${EX}Foo> <${RDFS}label> "Foo v1" .`,
            },
            {
              side: '+',
              subjectPath: `${EX}Foo`,
              predicate: `${RDFS}label`,
              object: '"Foo v2"',
              nquad: `<${EX}Foo> <${RDFS}label> "Foo v2" .`,
            },
          ],
          sourceRecords: { left: [], right: [] },
        },
      ],
    });
  });
});
