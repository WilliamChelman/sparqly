import { Parser, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import { diffCanonicalStatements, diffStores } from './diff';
import type { RdfDiffWithSourcesResult } from './diff';
import { groupRdfDiffByEntity } from './group-rdf-diff-by-entity';
import { formatGroupedRdfDiff } from './grouped-diff-formatter';

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

describe('formatGroupedRdfDiff', () => {
  it('emits the canonical `# left=L right=R +A -R` summary, then one block per hunk with a CURIE-shortened header and CURIE-shortened predicates/objects, eliding subjects equal to the anchor', () => {
    const left = [triple('a', 'p', 'b1')];
    const right = [triple('a', 'p', 'b2')];
    const diff = emptyResult(left, right);

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: storeOf(left.join('\n') + '\n') },
      right: { store: storeOf(right.join('\n') + '\n') },
    });

    const out = formatGroupedRdfDiff(hunked, {
      prefixes: { ex: 'http://example.org/' },
    });

    expect(out).toBe(
      '# left=1 right=1 +1 -1\n' +
        'ex:a  [-1 +1]\n' +
        '- ex:p ex:b1 .\n' +
        '+ ex:p ex:b2 .\n',
    );
  });

  it('renders absorbed-bnode lines with a path notation [sh:path <iri>] / <predicate> instead of the raw bnode subject', async () => {
    const SH = 'http://www.w3.org/ns/shacl#';
    const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
    const EX = 'http://example.org/';
    const leftNquads =
      `<${EX}Shape> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Shape> <${SH}property> _:l1 .\n` +
      `_:l1 <${SH}path> <${EX}foo> .\n` +
      `_:l1 <${SH}datatype> <http://www.w3.org/2001/XMLSchema#decimal> .\n`;
    const rightNquads =
      `<${EX}Shape> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Shape> <${SH}property> _:r1 .\n` +
      `_:r1 <${SH}path> <${EX}foo> .\n` +
      `_:r1 <${SH}datatype> <http://www.w3.org/2001/XMLSchema#integer> .\n`;
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

    const out = formatGroupedRdfDiff(hunked, {
      prefixes: {
        ex: 'http://example.org/',
        sh: 'http://www.w3.org/ns/shacl#',
        xsd: 'http://www.w3.org/2001/XMLSchema#',
      },
    });

    expect(out).toContain(
      '- [sh:path ex:foo] / sh:datatype xsd:decimal .\n' +
        '+ [sh:path ex:foo] / sh:datatype xsd:integer .\n',
    );
  });

  it('emits sections in order changed → removed → added, with `(removed)` and `(added)` markers in single-side headers', async () => {
    const SH = 'http://www.w3.org/ns/shacl#';
    const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
    const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
    const EX = 'http://example.org/';

    // Foo: changed (label flip). Bar: removed only on the left. Baz: added
    // only on the right. Output must list them in section order.
    const leftNquads =
      `<${EX}Foo> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Foo> <${RDFS}label> "Foo v1" .\n` +
      `<${EX}Bar> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Bar> <${RDFS}label> "Bar v1" .\n`;
    const rightNquads =
      `<${EX}Foo> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Foo> <${RDFS}label> "Foo v2" .\n` +
      `<${EX}Baz> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Baz> <${RDFS}label> "Baz v1" .\n`;

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

    const out = formatGroupedRdfDiff(hunked, {
      prefixes: {
        ex: 'http://example.org/',
        sh: 'http://www.w3.org/ns/shacl#',
        rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
      },
    });

    // changed → removed → added; removed/added carry section state in header.
    const headerLines = out.split('\n').filter((l) => l.includes('  ['));
    expect(headerLines).toEqual([
      'ex:Foo  (sh:NodeShape)  [-1 +1]',
      'ex:Bar  (sh:NodeShape)  (removed)  [-2 +0]',
      'ex:Baz  (sh:NodeShape)  (added)  [-0 +2]',
    ]);
  });

  it('renders rdf:type as a CURIE in the hunk header in parentheses', () => {
    const RDF_TYPE = '<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>';
    const SHAPE = '<http://www.w3.org/ns/shacl#NodeShape>';
    const leftStore =
      `${t('a')} ${RDF_TYPE} ${SHAPE} .\n${triple('a', 'p', 'b1')}\n`;
    const rightStore =
      `${t('a')} ${RDF_TYPE} ${SHAPE} .\n${triple('a', 'p', 'b2')}\n`;
    const diff = emptyResult([triple('a', 'p', 'b1')], [triple('a', 'p', 'b2')]);

    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: storeOf(leftStore) },
      right: { store: storeOf(rightStore) },
    });

    const out = formatGroupedRdfDiff(hunked, {
      prefixes: { ex: 'http://example.org/', sh: 'http://www.w3.org/ns/shacl#' },
    });

    expect(out).toContain('ex:a  (sh:NodeShape)  [-1 +1]\n');
  });
});
