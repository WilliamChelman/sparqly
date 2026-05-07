import { Parser, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import { diffCanonicalStatements } from './diff';
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
