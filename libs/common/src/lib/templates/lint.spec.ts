import { describe, expect, it } from 'vitest';
import type { ParameterDeclaration } from './parameter-declaration';
import { lint } from './lint';

function decl(p: ParameterDeclaration): ParameterDeclaration {
  return p;
}

describe('lint', () => {
  it('accepts a body that references every declared parameter', () => {
    const result = lint(
      [decl({ name: 'country', type: 'iri', cardinality: '1..1' })],
      'SELECT * WHERE { ?country ?p ?o }',
    );
    expect(result.isOk()).toBe(true);
  });

  it('flags a declared parameter whose name does not appear in the body', () => {
    const result = lint(
      [decl({ name: 'unused', type: 'iri', cardinality: '1..1' })],
      'SELECT * WHERE { ?s ?p ?o }',
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('declared-but-unused');
      expect(result.error.name).toBe('unused');
    }
  });

  it('flags a body variable that is neither projected nor declared', () => {
    const result = lint(
      [decl({ name: 'country', type: 'iri', cardinality: '1..1' })],
      'SELECT ?country WHERE { ?country a ?mystery }',
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('undeclared-body-variable');
      expect(result.error.name).toBe('mystery');
    }
  });

  it('accepts a body variable that appears in the SELECT projection', () => {
    const result = lint(
      [decl({ name: 'country', type: 'iri', cardinality: '1..1' })],
      'SELECT ?country ?p ?o WHERE { ?country ?p ?o }',
    );
    expect(result.isOk()).toBe(true);
  });

  it('does not flag free pattern variables when no parameters are declared', () => {
    // Literal (non-templated) saved queries: a free WHERE-only variable is
    // a normal SPARQL pattern variable, not a typo for a missing declaration.
    const result = lint([], 'SELECT ?x WHERE { ?x ?p ?o }');
    expect(result.isOk()).toBe(true);
  });
});
