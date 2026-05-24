import { describe, expect, it } from 'vitest';
import type { ParameterDeclaration } from 'common';
import { toWriteBody } from './to-write-body';

const cls: ParameterDeclaration = {
  name: 'cls',
  type: 'iri',
  cardinality: '1..1',
};

describe('toWriteBody', () => {
  it('omits the parameters key when the draft list is empty', () => {
    expect(toWriteBody('SELECT *', [])).toEqual({ body: 'SELECT *' });
  });

  it('includes the parameters key when at least one declaration is present', () => {
    expect(toWriteBody('SELECT ?b WHERE { ?b a ?cls }', [cls])).toEqual({
      body: 'SELECT ?b WHERE { ?b a ?cls }',
      parameters: [cls],
    });
  });
});
