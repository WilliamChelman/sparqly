import { decodeSparqlResult } from './sparql-result-decoder';

describe('decodeSparqlResult — ASK', () => {
  it('decodes ASK=true from SPARQL-results-JSON', () => {
    const body = JSON.stringify({ head: {}, boolean: true });
    const r = decodeSparqlResult(body, 'application/sparql-results+json');
    expect(r.kind).toBe('ask');
    if (r.kind === 'ask') expect(r.value).toBe(true);
  });

  it('decodes ASK=false', () => {
    const body = JSON.stringify({ head: {}, boolean: false });
    const r = decodeSparqlResult(body, 'application/sparql-results+json');
    expect(r.kind).toBe('ask');
    if (r.kind === 'ask') expect(r.value).toBe(false);
  });

  it('tolerates a content-type with parameters', () => {
    const body = JSON.stringify({ head: {}, boolean: true });
    const r = decodeSparqlResult(
      body,
      'application/sparql-results+json; charset=utf-8',
    );
    expect(r.kind).toBe('ask');
  });
});

describe('decodeSparqlResult — SELECT', () => {
  it('decodes a SELECT result with variables and bindings', () => {
    const body = JSON.stringify({
      head: { vars: ['s', 'p'] },
      results: {
        bindings: [
          {
            s: { type: 'uri', value: 'http://example.org/a' },
            p: { type: 'uri', value: 'http://example.org/p' },
          },
          {
            s: { type: 'bnode', value: 'b0' },
            p: { type: 'literal', value: 'hi', 'xml:lang': 'en' },
          },
        ],
      },
    });
    const r = decodeSparqlResult(body, 'application/sparql-results+json');
    expect(r.kind).toBe('select');
    if (r.kind !== 'select') return;
    expect(r.variables).toEqual(['s', 'p']);
    expect(r.bindings).toHaveLength(2);
    expect(r.bindings[0]['s']).toEqual({
      termType: 'NamedNode',
      value: 'http://example.org/a',
    });
    expect(r.bindings[1]['s']).toEqual({ termType: 'BlankNode', value: 'b0' });
    expect(r.bindings[1]['p']).toEqual({
      termType: 'Literal',
      value: 'hi',
      language: 'en',
    });
  });

  it('preserves a literal datatype on a SELECT binding', () => {
    const body = JSON.stringify({
      head: { vars: ['n'] },
      results: {
        bindings: [
          {
            n: {
              type: 'literal',
              value: '42',
              datatype: 'http://www.w3.org/2001/XMLSchema#integer',
            },
          },
        ],
      },
    });
    const r = decodeSparqlResult(body, 'application/sparql-results+json');
    if (r.kind !== 'select') throw new Error('expected select');
    expect(r.bindings[0]['n']).toEqual({
      termType: 'Literal',
      value: '42',
      datatype: { value: 'http://www.w3.org/2001/XMLSchema#integer' },
    });
  });

  it('omits unbound projection cells', () => {
    const body = JSON.stringify({
      head: { vars: ['s', 'p'] },
      results: {
        bindings: [
          { s: { type: 'uri', value: 'http://example.org/a' } },
        ],
      },
    });
    const r = decodeSparqlResult(body, 'application/sparql-results+json');
    if (r.kind !== 'select') throw new Error('expected select');
    expect(r.bindings[0]['s']).toBeDefined();
    expect(r.bindings[0]['p']).toBeUndefined();
  });
});

describe('decodeSparqlResult — fallback', () => {
  it('falls back to raw on malformed JSON without throwing', () => {
    const r = decodeSparqlResult(
      'not json',
      'application/sparql-results+json',
    );
    expect(r.kind).toBe('raw');
    if (r.kind === 'raw') expect(r.raw).toBe('not json');
  });

  it('falls back to raw on text/plain content type', () => {
    const r = decodeSparqlResult('hello', 'text/plain');
    expect(r.kind).toBe('raw');
  });

  it('falls back to raw on a SPARQL-JSON shape that lacks both boolean and bindings', () => {
    const body = JSON.stringify({ head: {} });
    const r = decodeSparqlResult(body, 'application/sparql-results+json');
    expect(r.kind).toBe('raw');
  });
});

describe('decodeSparqlResult — Turtle / N-Quads', () => {
  it('decodes a CONSTRUCT/DESCRIBE turtle body into a TripleResult', () => {
    const body =
      '<http://example.org/a> <http://example.org/p> <http://example.org/o> .\n';
    const r = decodeSparqlResult(body, 'text/turtle');
    expect(r.kind).toBe('triples');
    if (r.kind !== 'triples') return;
    expect(r.triples).toHaveLength(1);
    expect(r.triples[0].subject).toEqual({
      termType: 'NamedNode',
      value: 'http://example.org/a',
    });
    expect(r.triples[0].predicate).toEqual({
      termType: 'NamedNode',
      value: 'http://example.org/p',
    });
    expect(r.triples[0].object).toEqual({
      termType: 'NamedNode',
      value: 'http://example.org/o',
    });
  });

  it('decodes literal objects with language tags from turtle', () => {
    const body =
      '<http://example.org/a> <http://example.org/p> "hi"@en .\n';
    const r = decodeSparqlResult(body, 'text/turtle');
    if (r.kind !== 'triples') throw new Error('expected triples');
    expect(r.triples[0].object).toEqual({
      termType: 'Literal',
      value: 'hi',
      language: 'en',
    });
  });

  it('decodes n-quads with a graph term', () => {
    const body =
      '<http://example.org/a> <http://example.org/p> <http://example.org/o> <http://example.org/g> .\n';
    const r = decodeSparqlResult(body, 'application/n-quads');
    if (r.kind !== 'triples') throw new Error('expected triples');
    expect(r.triples[0].graph).toEqual({
      termType: 'NamedNode',
      value: 'http://example.org/g',
    });
  });

  it('falls back to raw on malformed turtle without throwing', () => {
    const r = decodeSparqlResult('this is not turtle <<<', 'text/turtle');
    expect(r.kind).toBe('raw');
  });
});
