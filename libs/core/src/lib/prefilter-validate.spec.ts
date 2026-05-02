import { describe, expect, it } from 'vitest';
import { validatePrefilter } from './prefilter-validate';

describe('validatePrefilter — accepted shapes', () => {
  it('accepts a SELECT projecting ?s ?p ?o', () => {
    expect(() =>
      validatePrefilter('SELECT ?s ?p ?o WHERE { ?s ?p ?o }'),
    ).not.toThrow();
  });

  it('accepts a SELECT projecting ?s ?p ?o ?g (quad form)', () => {
    expect(() =>
      validatePrefilter(
        'SELECT ?s ?p ?o ?g WHERE { GRAPH ?g { ?s ?p ?o } }',
      ),
    ).not.toThrow();
  });

  it('accepts SELECT regardless of variable order', () => {
    expect(() =>
      validatePrefilter('SELECT ?p ?o ?s WHERE { ?s ?p ?o }'),
    ).not.toThrow();
  });

  it('accepts a CONSTRUCT', () => {
    expect(() =>
      validatePrefilter('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }'),
    ).not.toThrow();
  });
});

describe('validatePrefilter — SELECT projection contract', () => {
  it('rejects SELECT * (star projection is ambiguous)', () => {
    expect(() => validatePrefilter('SELECT * WHERE { ?s ?p ?o }')).toThrow(
      /SELECT.*project.*\?s.*\?p.*\?o/i,
    );
  });

  it('rejects SELECT projecting only ?s ?p (missing ?o)', () => {
    expect(() =>
      validatePrefilter('SELECT ?s ?p WHERE { ?s ?p ?o }'),
    ).toThrow(/SELECT.*project.*\?s.*\?p.*\?o/i);
  });

  it('rejects SELECT projecting unrelated variables', () => {
    expect(() =>
      validatePrefilter('SELECT ?x ?y ?z WHERE { ?x ?y ?z }'),
    ).toThrow(/SELECT.*project.*\?s.*\?p.*\?o/i);
  });

  it('rejects SELECT with extra variables beyond ?s ?p ?o ?g', () => {
    expect(() =>
      validatePrefilter('SELECT ?s ?p ?o ?g ?extra WHERE { ?s ?p ?o }'),
    ).toThrow(/SELECT.*project.*\?s.*\?p.*\?o/i);
  });
});

describe('validatePrefilter — prefix awareness', () => {
  it('parses with PREFIX declarations (sparqljs-based, not regex)', () => {
    expect(() =>
      validatePrefilter(
        'PREFIX ex: <http://example.org/>\nCONSTRUCT { ?s ?p ?o } WHERE { ?s ex:p ?o }',
      ),
    ).not.toThrow();
  });

  it('reports a parse error on syntactically invalid SPARQL', () => {
    expect(() => validatePrefilter('not a query')).toThrow();
  });
});

describe('validatePrefilter — rejected query types', () => {
  it('rejects ASK', () => {
    expect(() => validatePrefilter('ASK { ?s ?p ?o }')).toThrow(
      /ASK.*not.*allowed.*prefilter/i,
    );
  });

  it('rejects DESCRIBE', () => {
    expect(() =>
      validatePrefilter('DESCRIBE <http://example.org/a>'),
    ).toThrow(/DESCRIBE.*not.*allowed.*prefilter/i);
  });

  it('rejects UPDATE (INSERT DATA)', () => {
    expect(() =>
      validatePrefilter(
        'INSERT DATA { <http://example.org/a> <http://example.org/p> <http://example.org/b> }',
      ),
    ).toThrow(/UPDATE.*not.*allowed.*prefilter/i);
  });
});
