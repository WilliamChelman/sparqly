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
