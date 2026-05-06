import { describe, expect, it } from 'vitest';
import { validateViewQuery } from './view-query-validate';

describe('validateViewQuery — accepted shapes', () => {
  it('accepts a SELECT projecting ?s ?p ?o', () => {
    expect(() =>
      validateViewQuery('SELECT ?s ?p ?o WHERE { ?s ?p ?o }'),
    ).not.toThrow();
  });

  it('accepts a SELECT projecting ?s ?p ?o ?g (quad form)', () => {
    expect(() =>
      validateViewQuery(
        'SELECT ?s ?p ?o ?g WHERE { GRAPH ?g { ?s ?p ?o } }',
      ),
    ).not.toThrow();
  });

  it('accepts SELECT regardless of variable order', () => {
    expect(() =>
      validateViewQuery('SELECT ?p ?o ?s WHERE { ?s ?p ?o }'),
    ).not.toThrow();
  });

  it('accepts a CONSTRUCT', () => {
    expect(() =>
      validateViewQuery('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }'),
    ).not.toThrow();
  });
});

describe('validateViewQuery — SELECT projection contract', () => {
  it('rejects SELECT * (star projection is ambiguous)', () => {
    expect(() => validateViewQuery('SELECT * WHERE { ?s ?p ?o }')).toThrow(
      /SELECT.*project.*\?s.*\?p.*\?o/i,
    );
  });

  it('rejects SELECT projecting only ?s ?p (missing ?o)', () => {
    expect(() =>
      validateViewQuery('SELECT ?s ?p WHERE { ?s ?p ?o }'),
    ).toThrow(/SELECT.*project.*\?s.*\?p.*\?o/i);
  });

  it('rejects SELECT projecting unrelated variables', () => {
    expect(() =>
      validateViewQuery('SELECT ?x ?y ?z WHERE { ?x ?y ?z }'),
    ).toThrow(/SELECT.*project.*\?s.*\?p.*\?o/i);
  });

  it('rejects SELECT with extra variables beyond ?s ?p ?o ?g', () => {
    expect(() =>
      validateViewQuery('SELECT ?s ?p ?o ?g ?extra WHERE { ?s ?p ?o }'),
    ).toThrow(/SELECT.*project.*\?s.*\?p.*\?o/i);
  });
});

describe('validateViewQuery — prefix awareness', () => {
  it('parses with PREFIX declarations (sparqljs-based, not regex)', () => {
    expect(() =>
      validateViewQuery(
        'PREFIX ex: <http://example.org/>\nCONSTRUCT { ?s ?p ?o } WHERE { ?s ex:p ?o }',
      ),
    ).not.toThrow();
  });

  it('reports a parse error on syntactically invalid SPARQL', () => {
    expect(() => validateViewQuery('not a query')).toThrow();
  });
});

describe('validateViewQuery — rejected query types', () => {
  it('rejects ASK', () => {
    expect(() => validateViewQuery('ASK { ?s ?p ?o }')).toThrow(
      /ASK.*not.*allowed/i,
    );
  });

  it('rejects DESCRIBE', () => {
    expect(() =>
      validateViewQuery('DESCRIBE <http://example.org/a>'),
    ).toThrow(/DESCRIBE.*not.*allowed/i);
  });

  it('rejects UPDATE (INSERT DATA)', () => {
    expect(() =>
      validateViewQuery(
        'INSERT DATA { <http://example.org/a> <http://example.org/p> <http://example.org/b> }',
      ),
    ).toThrow(/UPDATE.*not.*allowed/i);
  });
});

describe("validateViewQuery — mode 'tabular-anon'", () => {
  it('accepts an arbitrary single-var SELECT', () => {
    expect(() =>
      validateViewQuery('SELECT ?id WHERE { ?p <urn:id> ?id }', {
        mode: 'tabular-anon',
      }),
    ).not.toThrow();
  });

  it('accepts an arbitrary multi-var SELECT', () => {
    expect(() =>
      validateViewQuery(
        'SELECT ?id ?status WHERE { ?p <urn:id> ?id ; <urn:status> ?status }',
        { mode: 'tabular-anon' },
      ),
    ).not.toThrow();
  });

  it("still accepts the strict triples projections (mode is a relaxation, not a swap)", () => {
    expect(() =>
      validateViewQuery('SELECT ?s ?p ?o WHERE { ?s ?p ?o }', {
        mode: 'tabular-anon',
      }),
    ).not.toThrow();
    expect(() =>
      validateViewQuery('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }', {
        mode: 'tabular-anon',
      }),
    ).not.toThrow();
  });

  it('still rejects UPDATE/ASK/DESCRIBE under tabular-anon (the relaxation only widens projection)', () => {
    expect(() =>
      validateViewQuery('ASK { ?s ?p ?o }', { mode: 'tabular-anon' }),
    ).toThrow(/ASK.*not.*allowed/i);
    expect(() =>
      validateViewQuery('DESCRIBE <http://example.org/a>', {
        mode: 'tabular-anon',
      }),
    ).toThrow(/DESCRIBE.*not.*allowed/i);
    expect(() =>
      validateViewQuery(
        'INSERT DATA { <http://example.org/a> <http://example.org/p> <http://example.org/b> }',
        { mode: 'tabular-anon' },
      ),
    ).toThrow(/UPDATE.*not.*allowed/i);
  });

  it('still rejects SELECT * under tabular-anon (no stable variable list)', () => {
    expect(() =>
      validateViewQuery('SELECT * WHERE { ?s ?p ?o }', {
        mode: 'tabular-anon',
      }),
    ).toThrow();
  });
});
