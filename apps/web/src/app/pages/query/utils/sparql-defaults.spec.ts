import { acceptForQueryType, buildDefaultQuery } from './sparql-defaults';

describe('acceptForQueryType', () => {
  it('returns the JSON Accept for SELECT and ASK', () => {
    expect(acceptForQueryType('SELECT')).toBe('application/sparql-results+json');
    expect(acceptForQueryType('ASK')).toBe('application/sparql-results+json');
  });

  it('returns the Turtle Accept for CONSTRUCT and DESCRIBE', () => {
    expect(acceptForQueryType('CONSTRUCT')).toBe('text/turtle');
    expect(acceptForQueryType('DESCRIBE')).toBe('text/turtle');
  });

  it('returns undefined for an unrecognised type so the caller drops the Accept header', () => {
    expect(acceptForQueryType(undefined)).toBeUndefined();
    expect(acceptForQueryType('UPDATE')).toBeUndefined();
    expect(acceptForQueryType('')).toBeUndefined();
  });
});

describe('buildDefaultQuery', () => {
  it('seeds a classic ?s ?p ?o body when the context has no prefixes or base', () => {
    const out = buildDefaultQuery({ prefixes: {} });
    expect(out).toContain('SELECT');
    expect(out).toContain('?s ?p ?o');
  });

  it('prepends a BASE declaration from the context', () => {
    const out = buildDefaultQuery({
      prefixes: {},
      base: 'http://example.org/base/',
    });
    expect(out).toContain('BASE <http://example.org/base/>');
    expect(out).toContain('?s ?p ?o');
  });

  it('prepends one PREFIX line per context prefix', () => {
    const out = buildDefaultQuery({
      prefixes: {
        rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
        ex: 'http://example.org/',
      },
    });
    expect(out).toContain(
      'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>',
    );
    expect(out).toContain('PREFIX ex: <http://example.org/>');
    expect(out).toContain('?s ?p ?o');
  });

  it('separates the declarations from the body with a blank line when any declaration is present', () => {
    const out = buildDefaultQuery({
      prefixes: { ex: 'http://example.org/' },
    });
    const before = out.indexOf('SELECT');
    expect(out.slice(0, before)).toMatch(/\n\n$/);
  });
});
