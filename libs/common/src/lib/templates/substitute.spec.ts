import { describe, expect, it } from 'vitest';
import type { ParameterDeclaration } from './parameter-declaration';
import { substitute } from './substitute';

function decl(p: ParameterDeclaration): ParameterDeclaration {
  return p;
}

describe('substitute', () => {
  it('returns the body verbatim when the parameter list is empty', () => {
    const body = 'SELECT * WHERE { ?s ?p ?o }';
    const result = substitute({ body, parameters: [] }, {});
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(body);
    }
  });

  it('emits bare numerics for integer / decimal types', () => {
    const body = 'SELECT * WHERE { ?y ?d ?o }';
    const result = substitute(
      {
        body,
        parameters: [
          decl({ name: 'y', type: 'integer', cardinality: '1..1' }),
          decl({ name: 'd', type: 'decimal', cardinality: '1..1' }),
        ],
      },
      { y: 2026, d: 3.14 },
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('VALUES (?y ?d) { (2026 3.14) }');
    }
  });

  it('emits SPARQL booleans true / false', () => {
    const body = 'ASK { ?s ?p ?o }';
    const result = substitute(
      {
        body,
        parameters: [
          decl({ name: 'flag', type: 'boolean', cardinality: '1..1' }),
        ],
      },
      { flag: true },
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('(true)');
    }
  });

  it('emits typed xsd:date / xsd:dateTime literals', () => {
    const body = 'SELECT * WHERE { ?d ?dt ?o }';
    const result = substitute(
      {
        body,
        parameters: [
          decl({ name: 'd', type: 'date', cardinality: '1..1' }),
          decl({ name: 'dt', type: 'dateTime', cardinality: '1..1' }),
        ],
      },
      { d: '2024-01-15', dt: '2024-01-15T12:34:56Z' },
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain(
        '("2024-01-15"^^xsd:date "2024-01-15T12:34:56Z"^^xsd:dateTime)',
      );
    }
  });

  it('emits a lang-tagged string', () => {
    const body = 'SELECT * WHERE { ?label ?p ?o }';
    const result = substitute(
      {
        body,
        parameters: [
          decl({ name: 'label', type: 'langString', cardinality: '1..1' }),
        ],
      },
      { label: { value: 'bonjour', lang: 'fr' } },
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('("bonjour"@fr)');
    }
  });

  it('emits a literal with an open datatype IRI', () => {
    const body = 'SELECT * WHERE { ?span ?p ?o }';
    const result = substitute(
      {
        body,
        parameters: [
          decl({
            name: 'span',
            type: 'literal',
            cardinality: '1..1',
            datatype: 'http://www.w3.org/2001/XMLSchema#duration',
          }),
        ],
      },
      { span: 'P1D' },
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain(
        '("P1D"^^<http://www.w3.org/2001/XMLSchema#duration>)',
      );
    }
  });

  it('emits a multi-row VALUES for 1..n bindings', () => {
    const body = 'SELECT * WHERE { ?country ?p ?o }';
    const result = substitute(
      {
        body,
        parameters: [
          decl({ name: 'country', type: 'iri', cardinality: '1..n' }),
        ],
      },
      {
        country: ['http://example.org/CA', 'http://example.org/US'],
      },
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain(
        'VALUES (?country) { (<http://example.org/CA>) (<http://example.org/US>) }',
      );
    }
  });

  it('omits an unbound 0..1 column entirely', () => {
    const body = 'SELECT * WHERE { ?country ?p ?o }';
    const result = substitute(
      {
        body,
        parameters: [
          decl({ name: 'country', type: 'iri', cardinality: '0..1' }),
        ],
      },
      {},
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // The only declared column was omitted, so no VALUES clause at all.
      expect(result.value).toBe(body);
    }
  });

  it('keeps a bound 0..1 column with one row', () => {
    const body = 'SELECT * WHERE { ?country ?p ?o }';
    const result = substitute(
      {
        body,
        parameters: [
          decl({ name: 'country', type: 'iri', cardinality: '0..1' }),
        ],
      },
      { country: 'http://example.org/CA' },
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(
        'VALUES (?country) { (<http://example.org/CA>) }\n' + body,
      );
    }
  });

  it('omits an empty 0..n column but keeps a bound one alongside it', () => {
    const body = 'SELECT * WHERE { ?year ?p ?o }';
    const result = substitute(
      {
        body,
        parameters: [
          decl({ name: 'country', type: 'iri', cardinality: '0..n' }),
          decl({ name: 'year', type: 'integer', cardinality: '0..n' }),
        ],
      },
      { year: [2024, 2025] },
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('VALUES (?year) { (2024) (2025) }');
      // The unbound 0..n column is omitted from the VALUES header itself.
      expect(result.value).not.toContain('?country');
    }
  });

  it('preserves declared order as VALUES column order', () => {
    const body = 'SELECT * WHERE { ?country ?year ?p ?o }';
    const result = substitute(
      {
        body,
        parameters: [
          decl({ name: 'country', type: 'iri', cardinality: '1..1' }),
          decl({ name: 'year', type: 'integer', cardinality: '1..1' }),
        ],
      },
      { year: 2024, country: 'http://example.org/CA' },
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain(
        'VALUES (?country ?year) { (<http://example.org/CA> 2024) }',
      );
    }
  });

  it('escapes a string / 1..1 binding with quotes and backslashes', () => {
    const body = 'SELECT * WHERE { ?label ?p ?o }';
    const result = substitute(
      {
        body,
        parameters: [
          decl({ name: 'label', type: 'string', cardinality: '1..1' }),
        ],
      },
      { label: 'a "quote" \\ and\nnewline' },
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain(
        '("a \\"quote\\" \\\\ and\\nnewline")',
      );
    }
  });

  it('prepends a single-row VALUES clause for one iri / 1..1 parameter', () => {
    const body = 'SELECT * WHERE { ?country ?p ?o }';
    const result = substitute(
      {
        body,
        parameters: [
          decl({ name: 'country', type: 'iri', cardinality: '1..1' }),
        ],
      },
      { country: 'http://example.org/CA' },
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(
        'VALUES (?country) { (<http://example.org/CA>) }\n' + body,
      );
    }
  });
});
