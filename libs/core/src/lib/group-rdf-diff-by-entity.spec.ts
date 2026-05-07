import { Parser, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import { diffCanonicalStatements, diffStores } from './diff';
import type { RdfDiffWithSourcesResult } from './diff';
import { groupRdfDiffByEntity } from './group-rdf-diff-by-entity';

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

function withSourceRecords(
  base: RdfDiffWithSourcesResult,
  recs: {
    left?: ReadonlyArray<readonly [string, ReadonlyArray<{ file: string; line?: number }>]>;
    right?: ReadonlyArray<readonly [string, ReadonlyArray<{ file: string; line?: number }>]>;
  },
): RdfDiffWithSourcesResult {
  const left = new Map<string, { file: string; line?: number }[]>();
  const right = new Map<string, { file: string; line?: number }[]>();
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
