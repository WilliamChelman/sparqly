import { describe, expect, it } from 'vitest';
import { validateInlineQueryResult } from './validate-query';

function expectOk(query: string, mode?: 'strict' | 'tabular-anon'): void {
  const result = validateInlineQueryResult(
    query,
    mode ? { mode } : undefined,
  );
  expect(result.isOk()).toBe(true);
}

function expectErr(
  query: string,
  pattern: RegExp,
  mode?: 'strict' | 'tabular-anon',
): void {
  const result = validateInlineQueryResult(query, mode ? { mode } : undefined);
  expect(result.isErr()).toBe(true);
  if (!result.isErr()) throw new Error('unreachable');
  expect(result.error.kind).toBe('inline-query-validation');
  expect(result.error.message).toMatch(pattern);
}

describe('validateInlineQueryResult — accepted shapes', () => {
  it('accepts a SELECT projecting ?s ?p ?o', () => {
    expectOk('SELECT ?s ?p ?o WHERE { ?s ?p ?o }');
  });

  it('accepts a SELECT projecting ?s ?p ?o ?g (quad form)', () => {
    expectOk('SELECT ?s ?p ?o ?g WHERE { GRAPH ?g { ?s ?p ?o } }');
  });

  it('accepts SELECT regardless of variable order', () => {
    expectOk('SELECT ?p ?o ?s WHERE { ?s ?p ?o }');
  });

  it('accepts a CONSTRUCT', () => {
    expectOk('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }');
  });

  it('parses with PREFIX declarations (sparqljs-based, not regex)', () => {
    expectOk(
      'PREFIX ex: <http://example.org/>\nCONSTRUCT { ?s ?p ?o } WHERE { ?s ex:p ?o }',
    );
  });
});

describe('validateInlineQueryResult — SELECT projection contract', () => {
  it('rejects SELECT * (star projection is ambiguous)', () => {
    expectErr('SELECT * WHERE { ?s ?p ?o }', /SELECT.*project.*\?s.*\?p.*\?o/i);
  });

  it('rejects SELECT projecting only ?s ?p (missing ?o)', () => {
    expectErr('SELECT ?s ?p WHERE { ?s ?p ?o }', /SELECT.*project.*\?s.*\?p.*\?o/i);
  });

  it('rejects SELECT projecting unrelated variables', () => {
    expectErr('SELECT ?x ?y ?z WHERE { ?x ?y ?z }', /SELECT.*project.*\?s.*\?p.*\?o/i);
  });

  it('rejects SELECT with extra variables beyond ?s ?p ?o ?g', () => {
    expectErr(
      'SELECT ?s ?p ?o ?g ?extra WHERE { ?s ?p ?o }',
      /SELECT.*project.*\?s.*\?p.*\?o/i,
    );
  });

  it('rejects aliased projection expressions under strict mode', () => {
    expectErr(
      'SELECT (str(?x) AS ?y) ?z WHERE { ?x <urn:p> ?z }',
      /SELECT.*project.*\?s.*\?p.*\?o/i,
    );
  });
});

describe('validateInlineQueryResult — rejected query types', () => {
  it('rejects ASK', () => {
    expectErr('ASK { ?s ?p ?o }', /ASK.*not.*allowed/i);
  });

  it('rejects DESCRIBE', () => {
    expectErr('DESCRIBE <http://example.org/a>', /DESCRIBE.*not.*allowed/i);
  });

  it('rejects UPDATE (INSERT DATA)', () => {
    expectErr(
      'INSERT DATA { <http://example.org/a> <http://example.org/p> <http://example.org/b> }',
      /UPDATE.*not.*allowed/i,
    );
  });

  it('reports a parse error on syntactically invalid SPARQL', () => {
    const result = validateInlineQueryResult('not a query');
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('inline-query-validation');
    expect(result.error.message.length).toBeGreaterThan(0);
  });
});

describe("validateInlineQueryResult — mode 'tabular-anon'", () => {
  it('accepts an arbitrary single-var SELECT', () => {
    expectOk('SELECT ?id WHERE { ?p <urn:id> ?id }', 'tabular-anon');
  });

  it('accepts an arbitrary multi-var SELECT', () => {
    expectOk(
      'SELECT ?id ?status WHERE { ?p <urn:id> ?id ; <urn:status> ?status }',
      'tabular-anon',
    );
  });

  it('still accepts the strict triples projections (mode is a relaxation, not a swap)', () => {
    expectOk('SELECT ?s ?p ?o WHERE { ?s ?p ?o }', 'tabular-anon');
    expectOk('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }', 'tabular-anon');
  });

  it('still rejects UPDATE/ASK/DESCRIBE under tabular-anon (the relaxation only widens projection)', () => {
    expectErr('ASK { ?s ?p ?o }', /ASK.*not.*allowed/i, 'tabular-anon');
    expectErr(
      'DESCRIBE <http://example.org/a>',
      /DESCRIBE.*not.*allowed/i,
      'tabular-anon',
    );
    expectErr(
      'INSERT DATA { <http://example.org/a> <http://example.org/p> <http://example.org/b> }',
      /UPDATE.*not.*allowed/i,
      'tabular-anon',
    );
  });

  it('still rejects SELECT * under tabular-anon (no stable variable list)', () => {
    expectErr('SELECT * WHERE { ?s ?p ?o }', /SELECT.*project/i, 'tabular-anon');
  });

  it('accepts aliased projection expressions under tabular-anon', () => {
    expectOk(
      'SELECT (str(?x) AS ?y) ?z WHERE { ?x <urn:p> ?z }',
      'tabular-anon',
    );
  });
});
