import { describe, expect, it } from 'vitest';
import {
  diffCanonicalStatements,
  formatRdfDiff,
  type RdfDiffResult,
} from './diff';

const t = (iri: string): string => `<http://example.org/${iri}>`;
const triple = (s: string, p: string, o: string): string =>
  `${t(s)} ${t(p)} ${t(o)} .`;
const quad = (s: string, p: string, o: string, g: string): string =>
  `${t(s)} ${t(p)} ${t(o)} ${t(g)} .`;

describe('diffCanonicalStatements + formatRdfDiff', () => {
  it('human format emits removed lines, then added lines, each prefixed and newline-terminated', () => {
    const left = [triple('a', 'p', 'b'), triple('c', 'q', 'd')];
    const right = [triple('a', 'p', 'b'), triple('e', 'r', 'f')];

    const out = formatRdfDiff(diffCanonicalStatements(left, right), 'human');

    expect(out).toBe(
      `- ${triple('c', 'q', 'd')}\n` + `+ ${triple('e', 'r', 'f')}\n`,
    );
  });

  it('json format emits {added,removed} with termType, value, and language tag for literals', () => {
    const added = `${t('c')} ${t('q')} "hi"@en .`;
    const diff: RdfDiffResult = { added: [added], removed: [] };

    const parsed = JSON.parse(formatRdfDiff(diff, 'json'));

    expect(parsed.removed).toEqual([]);
    expect(parsed.added).toHaveLength(1);
    expect(parsed.added[0].s).toEqual({
      termType: 'NamedNode',
      value: 'http://example.org/c',
    });
    expect(parsed.added[0].p).toEqual({
      termType: 'NamedNode',
      value: 'http://example.org/q',
    });
    expect(parsed.added[0].o).toMatchObject({
      termType: 'Literal',
      value: 'hi',
      language: 'en',
    });
    expect(parsed.added[0].g).toBeUndefined();
  });

  it('json format emits a graph component for statements outside the default graph', () => {
    const removed = quad('a', 'p', 'b', 'g1');
    const added = triple('a', 'p', 'b');
    const diff: RdfDiffResult = { added: [added], removed: [removed] };

    const parsed = JSON.parse(formatRdfDiff(diff, 'json'));

    expect(parsed.removed).toHaveLength(1);
    expect(parsed.removed[0].g).toEqual({
      termType: 'NamedNode',
      value: 'http://example.org/g1',
    });
    expect(parsed.added).toHaveLength(1);
    expect(parsed.added[0].g).toBeUndefined();
  });

  it('rdf-patch format emits all D markers before any A marker', () => {
    const left = [triple('a', 'p', 'b'), triple('c', 'q', 'd')];
    const right = [triple('a', 'p', 'b'), triple('e', 'r', 'f')];

    const out = formatRdfDiff(
      diffCanonicalStatements(left, right),
      'rdf-patch',
    );

    const lines = out.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^D /);
    expect(lines[1]).toMatch(/^A /);
  });

  it('output is stable: same inputs produce byte-identical output across invocations, and added/removed are sorted', () => {
    const left = [
      triple('c', 'p', 'c2'),
      triple('a', 'p', 'a2'),
      triple('b', 'p', 'b2'),
    ];
    const right = [triple('a', 'p', 'a2')];

    const first = formatRdfDiff(diffCanonicalStatements(left, right), 'human');
    const second = formatRdfDiff(diffCanonicalStatements(left, right), 'human');

    expect(first).toBe(second);

    const removed = first
      .split('\n')
      .filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2));
    expect(removed).toEqual([...removed].sort());
    expect(removed).toHaveLength(2);
  });
});
