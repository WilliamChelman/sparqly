import { countPrefixes, detectQueryType } from './query-detection';

describe('detectQueryType', () => {
  it('returns SELECT for a plain SELECT query', () => {
    expect(detectQueryType('SELECT ?s WHERE { ?s ?p ?o }')).toBe('SELECT');
  });

  it('returns CONSTRUCT, ASK, DESCRIBE for the corresponding keywords', () => {
    expect(detectQueryType('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }')).toBe(
      'CONSTRUCT',
    );
    expect(detectQueryType('ASK { ?s ?p ?o }')).toBe('ASK');
    expect(detectQueryType('DESCRIBE <http://example.org/x>')).toBe('DESCRIBE');
  });

  it('is case-insensitive at the source but normalises to upper-case', () => {
    expect(detectQueryType('select ?s where { ?s ?p ?o }')).toBe('SELECT');
  });

  it('skips leading PREFIX and BASE declarations', () => {
    const q =
      'PREFIX ex: <http://example.org/>\nBASE <http://example.org/>\nSELECT ?s WHERE { ?s ?p ?o }';
    expect(detectQueryType(q)).toBe('SELECT');
  });

  it('skips leading line comments', () => {
    const q = '# a comment\n# another\nASK { ?s ?p ?o }';
    expect(detectQueryType(q)).toBe('ASK');
  });

  it('returns undefined when no query form is recognised', () => {
    expect(detectQueryType('')).toBeUndefined();
    expect(detectQueryType('   ')).toBeUndefined();
    expect(detectQueryType('PREFIX ex: <http://example.org/>')).toBeUndefined();
    expect(detectQueryType('INSERT DATA { <a> <b> <c> }')).toBeUndefined();
  });
});

describe('countPrefixes', () => {
  it('returns 0 for a query without PREFIX declarations', () => {
    expect(countPrefixes('SELECT ?s WHERE { ?s ?p ?o }')).toBe(0);
  });

  it('counts each PREFIX line', () => {
    const q =
      'PREFIX ex: <http://example.org/>\n' +
      'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\n' +
      'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\n' +
      'SELECT ?s WHERE { ?s ?p ?o }';
    expect(countPrefixes(q)).toBe(3);
  });

  it('is case-insensitive on the PREFIX keyword', () => {
    const q =
      'prefix ex: <http://example.org/>\n' +
      'Prefix foo: <http://foo.example/>\n' +
      'SELECT ?s WHERE { ?s ?p ?o }';
    expect(countPrefixes(q)).toBe(2);
  });

  it('does not count BASE or string literals that contain "PREFIX"', () => {
    const q =
      'BASE <http://example.org/>\n' +
      'PREFIX ex: <http://example.org/>\n' +
      'SELECT ?s WHERE { ?s ?p "PREFIX in a literal" }';
    expect(countPrefixes(q)).toBe(1);
  });

  it('does not double-count repeated PREFIX declarations of the same prefix', () => {
    const q =
      'PREFIX ex: <http://example.org/v1/>\n' +
      'PREFIX ex: <http://example.org/v2/>\n' +
      'SELECT ?s WHERE { ?s ?p ?o }';
    expect(countPrefixes(q)).toBe(1);
  });
});
