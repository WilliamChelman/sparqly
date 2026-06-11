import { buildDefaultQuery, buildQuickQuery } from './sparql-defaults';

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

describe('buildQuickQuery', () => {
  const emptyCtx = { prefixes: {} };
  const richCtx = {
    prefixes: { ex: 'http://example.org/' },
    base: 'http://example.org/base/',
  };

  describe('select-spo', () => {
    it('emits a SELECT ?s ?p ?o body with no header when the context is empty', () => {
      const out = buildQuickQuery('select-spo', emptyCtx);
      expect(out).toContain('SELECT ?s ?p ?o');
      expect(out).toContain('?s ?p ?o .');
      expect(out).not.toContain('PREFIX');
      expect(out).not.toContain('BASE');
    });

    it('prepends BASE and PREFIX lines from the context when present', () => {
      const out = buildQuickQuery('select-spo', richCtx);
      expect(out).toContain('BASE <http://example.org/base/>');
      expect(out).toContain('PREFIX ex: <http://example.org/>');
      const before = out.indexOf('SELECT');
      expect(out.slice(0, before)).toMatch(/\n\n$/);
    });

    it('matches buildDefaultQuery exactly', () => {
      expect(buildQuickQuery('select-spo', richCtx)).toBe(
        buildDefaultQuery(richCtx),
      );
    });
  });

  describe('select-spog', () => {
    it('emits a SELECT with a GRAPH ?g pattern and no header on empty context', () => {
      const out = buildQuickQuery('select-spog', emptyCtx);
      expect(out).toContain('SELECT ?s ?p ?o ?g');
      expect(out).toContain('GRAPH ?g');
      expect(out).toContain('?s ?p ?o');
      expect(out).not.toContain('PREFIX');
    });

    it('prepends the context header when prefixes/base are present', () => {
      const out = buildQuickQuery('select-spog', richCtx);
      expect(out).toContain('BASE <http://example.org/base/>');
      expect(out).toContain('PREFIX ex: <http://example.org/>');
      expect(out).toContain('GRAPH ?g');
    });
  });

  describe('construct-spo', () => {
    it('emits a CONSTRUCT { ?s ?p ?o } body with no header on empty context', () => {
      const out = buildQuickQuery('construct-spo', emptyCtx);
      expect(out).toContain('CONSTRUCT');
      expect(out).toContain('?s ?p ?o');
      expect(out).not.toContain('SELECT');
      expect(out).not.toContain('PREFIX');
    });

    it('prepends the context header when prefixes/base are present', () => {
      const out = buildQuickQuery('construct-spo', richCtx);
      expect(out).toContain('BASE <http://example.org/base/>');
      expect(out).toContain('PREFIX ex: <http://example.org/>');
      expect(out).toContain('CONSTRUCT');
    });
  });

  describe('clear', () => {
    it('returns an empty string on empty context', () => {
      expect(buildQuickQuery('clear', emptyCtx)).toBe('');
    });

    it('returns an empty string regardless of context (clear means empty)', () => {
      expect(buildQuickQuery('clear', richCtx)).toBe('');
    });
  });
});
