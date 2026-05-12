import { describe, expect, it } from 'vitest';
import { parseSparqlResultsJson } from './sparql-results';

describe('parseSparqlResultsJson', () => {
  it('parses URI, plain/typed/lang literals, and blank nodes', () => {
    const rows = parseSparqlResultsJson(
      JSON.stringify({
        head: { vars: ['s', 'plain', 'lang', 'typed', 'b'] },
        results: {
          bindings: [
            {
              s: { type: 'uri', value: 'http://example.org/alice' },
              plain: { type: 'literal', value: 'hi' },
              lang: { type: 'literal', value: 'bonjour', 'xml:lang': 'fr' },
              typed: {
                type: 'literal',
                value: '42',
                datatype: 'http://www.w3.org/2001/XMLSchema#integer',
              },
              b: { type: 'bnode', value: 'b0' },
            },
          ],
        },
      }),
    );
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r['s'].termType).toBe('NamedNode');
    expect(r['s'].value).toBe('http://example.org/alice');
    expect(r['plain'].termType).toBe('Literal');
    expect((r['lang'] as { language: string }).language).toBe('fr');
    expect((r['typed'] as { datatype: { value: string } }).datatype.value).toBe(
      'http://www.w3.org/2001/XMLSchema#integer',
    );
    expect(r['b'].termType).toBe('BlankNode');
  });

  it('parses RDF-star triple terms recursively', () => {
    const rows = parseSparqlResultsJson(
      JSON.stringify({
        head: { vars: ['t'] },
        results: {
          bindings: [
            {
              t: {
                type: 'triple',
                value: {
                  subject: { type: 'uri', value: 'http://example.org/alice' },
                  predicate: { type: 'uri', value: 'http://example.org/knows' },
                  object: { type: 'uri', value: 'http://example.org/bob' },
                },
              },
            },
          ],
        },
      }),
    );
    expect(rows[0]['t'].termType as string).toBe('Quad');
    expect((rows[0]['t'] as unknown as { predicate: { value: string } }).predicate.value).toBe(
      'http://example.org/knows',
    );
  });

  it('returns an empty array for a result with no bindings', () => {
    expect(
      parseSparqlResultsJson(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } })),
    ).toEqual([]);
    expect(parseSparqlResultsJson(JSON.stringify({ boolean: true }))).toEqual([]);
  });

  it('omits unbound variables (absent from the row object)', () => {
    const rows = parseSparqlResultsJson(
      JSON.stringify({
        head: { vars: ['s', 'g'] },
        results: { bindings: [{ s: { type: 'uri', value: 'http://example.org/x' } }] },
      }),
    );
    expect(Object.keys(rows[0])).toEqual(['s']);
    expect(rows[0]['g']).toBeUndefined();
  });
});
