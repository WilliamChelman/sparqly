import { describe, expect, it } from 'vitest';
import { ParameterDeclarationSchema } from './parameter-declaration';

describe('ParameterDeclarationSchema', () => {
  it('accepts a minimal iri / 1..1 declaration', () => {
    const parsed = ParameterDeclarationSchema.safeParse({
      name: 'country',
      type: 'iri',
      cardinality: '1..1',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown type', () => {
    const parsed = ParameterDeclarationSchema.safeParse({
      name: 'country',
      type: 'uri',
      cardinality: '1..1',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an unknown cardinality', () => {
    const parsed = ParameterDeclarationSchema.safeParse({
      name: 'country',
      type: 'iri',
      cardinality: 'one',
    });
    expect(parsed.success).toBe(false);
  });

  it('requires a datatype IRI for type "literal"', () => {
    const ok = ParameterDeclarationSchema.safeParse({
      name: 'span',
      type: 'literal',
      cardinality: '1..1',
      datatype: 'http://www.w3.org/2001/XMLSchema#duration',
    });
    expect(ok.success).toBe(true);
    const bad = ParameterDeclarationSchema.safeParse({
      name: 'span',
      type: 'literal',
      cardinality: '1..1',
    });
    expect(bad.success).toBe(false);
  });

  it('forbids datatype on non-literal types', () => {
    const parsed = ParameterDeclarationSchema.safeParse({
      name: 'year',
      type: 'integer',
      cardinality: '1..1',
      datatype: 'http://www.w3.org/2001/XMLSchema#int',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts label/description/default/enum presentation fields', () => {
    const parsed = ParameterDeclarationSchema.safeParse({
      name: 'country',
      type: 'iri',
      cardinality: '1..1',
      label: 'Country',
      description: 'ISO country IRI',
      default: 'http://example.org/CA',
      enum: ['http://example.org/CA', 'http://example.org/US'],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown sibling fields (strict)', () => {
    const parsed = ParameterDeclarationSchema.safeParse({
      name: 'country',
      type: 'iri',
      cardinality: '1..1',
      mystery: 1,
    });
    expect(parsed.success).toBe(false);
  });
});
