import { describe, expect, it } from 'vitest';
import { detectSelectShape } from './select-shape-detector';

describe('detectSelectShape — shape classification', () => {
  it('classifies a CONSTRUCT as triples', () => {
    const r = detectSelectShape('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }');
    expect(r.shape).toBe('triples');
  });

  it('classifies SELECT ?s ?p ?o as triples', () => {
    const r = detectSelectShape('SELECT ?s ?p ?o WHERE { ?s ?p ?o }');
    expect(r.shape).toBe('triples');
  });

  it('classifies SELECT ?s ?p ?o ?g as triples', () => {
    const r = detectSelectShape(
      'SELECT ?s ?p ?o ?g WHERE { GRAPH ?g { ?s ?p ?o } }',
    );
    expect(r.shape).toBe('triples');
  });

  it('classifies a single-var SELECT as tuples', () => {
    const r = detectSelectShape('SELECT ?id WHERE { ?p <urn:id> ?id }');
    expect(r.shape).toBe('tuples');
    expect(r.variables).toEqual(['id']);
  });

  it('classifies a multi-var SELECT as tuples and reports projected variable names in projection order', () => {
    const r = detectSelectShape(
      'SELECT ?id ?status WHERE { ?p <urn:id> ?id ; <urn:status> ?status }',
    );
    expect(r.shape).toBe('tuples');
    expect(r.variables).toEqual(['id', 'status']);
  });

  it('classifies SELECT with aliased projection expressions as tuples and surfaces alias names', () => {
    const r = detectSelectShape(
      'SELECT (str(?x) AS ?y) ?z WHERE { ?x <urn:p> ?z }',
    );
    expect(r.shape).toBe('tuples');
    expect(r.variables).toEqual(['y', 'z']);
  });
});

describe('detectSelectShape — rejected query types', () => {
  it('rejects ASK', () => {
    expect(() => detectSelectShape('ASK { ?s ?p ?o }')).toThrow(
      /ASK.*not.*allowed/i,
    );
  });

  it('rejects DESCRIBE', () => {
    expect(() =>
      detectSelectShape('DESCRIBE <http://example.org/a>'),
    ).toThrow(/DESCRIBE.*not.*allowed/i);
  });

  it('rejects UPDATE (INSERT DATA)', () => {
    expect(() =>
      detectSelectShape(
        'INSERT DATA { <http://example.org/a> <http://example.org/p> <http://example.org/b> }',
      ),
    ).toThrow(/UPDATE.*not.*allowed/i);
  });
});

describe('detectSelectShape — modifiers', () => {
  it('accepts ORDER BY without warning', () => {
    const r = detectSelectShape(
      'SELECT ?id WHERE { ?p <urn:id> ?id } ORDER BY ?id',
    );
    expect(r.shape).toBe('tuples');
    expect(r.warnLimitOffsetWithoutOrderBy).toBe(false);
  });

  it('accepts LIMIT with ORDER BY without warning', () => {
    const r = detectSelectShape(
      'SELECT ?id WHERE { ?p <urn:id> ?id } ORDER BY ?id LIMIT 10',
    );
    expect(r.warnLimitOffsetWithoutOrderBy).toBe(false);
  });

  it('warns when LIMIT is used without ORDER BY (silent non-determinism trap)', () => {
    const r = detectSelectShape(
      'SELECT ?id WHERE { ?p <urn:id> ?id } LIMIT 10',
    );
    expect(r.warnLimitOffsetWithoutOrderBy).toBe(true);
  });

  it('warns when OFFSET is used without ORDER BY', () => {
    const r = detectSelectShape(
      'SELECT ?id WHERE { ?p <urn:id> ?id } OFFSET 5',
    );
    expect(r.warnLimitOffsetWithoutOrderBy).toBe(true);
  });
});
