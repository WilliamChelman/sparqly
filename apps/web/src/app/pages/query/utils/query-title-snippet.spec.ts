import { describe, expect, it } from 'vitest';
import { queryTitleSnippet } from './query-title-snippet';

describe('queryTitleSnippet', () => {
  it('drops leading PREFIX declarations and starts at the query body', () => {
    const body = [
      'PREFIX foaf: <http://xmlns.com/foaf/0.1/>',
      'PREFIX ex: <http://example.org/>',
      'SELECT ?s WHERE { ?s a foaf:Person }',
    ].join('\n');
    expect(queryTitleSnippet(body)).toBe('SELECT ?s WHERE { ?s a foaf:Person }');
  });

  it('truncates a long body to ~40 chars with an ellipsis', () => {
    const body =
      'SELECT ?subject ?predicate ?object WHERE { ?subject ?predicate ?object }';
    expect(queryTitleSnippet(body)).toBe(
      'SELECT ?subject ?predicate ?object WHERE…',
    );
  });

  it('skips leading comments, blank lines, and BASE before the body', () => {
    const body = [
      '# entities missing a label',
      '',
      'BASE <http://example.org/>',
      '',
      'ASK { ?s ?p ?o }',
    ].join('\n');
    expect(queryTitleSnippet(body)).toBe('ASK { ?s ?p ?o }');
  });

  it('returns empty for an empty body', () => {
    expect(queryTitleSnippet('')).toBe('');
    expect(queryTitleSnippet('   \n  ')).toBe('');
  });

  it('returns empty when the buffer is all preamble', () => {
    const body = 'PREFIX ex: <http://example.org/>\n# nothing else yet';
    expect(queryTitleSnippet(body)).toBe('');
  });
});
