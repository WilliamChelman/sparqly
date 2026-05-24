import { describe, expect, it } from 'vitest';
import type { ParameterDeclaration } from 'common';
import { isDraftModified } from './is-draft-modified';

const cls: ParameterDeclaration = {
  name: 'cls',
  type: 'iri',
  cardinality: '1..1',
};
const country: ParameterDeclaration = {
  name: 'country',
  type: 'string',
  cardinality: '1..1',
};

describe('isDraftModified', () => {
  const loaded = { body: 'SELECT ?orig', parameters: [] };

  it('returns false when body and parameters match the loaded entry', () => {
    expect(
      isDraftModified(loaded, { body: 'SELECT ?orig', parameters: [] }),
    ).toBe(false);
  });

  it('returns true when only the body has diverged', () => {
    expect(
      isDraftModified(loaded, { body: 'SELECT ?edited', parameters: [] }),
    ).toBe(true);
  });

  it('returns true when only the parameter declarations have diverged', () => {
    expect(
      isDraftModified(
        { body: 'SELECT ?country', parameters: [] },
        { body: 'SELECT ?country', parameters: [country] },
      ),
    ).toBe(true);
  });

  it('returns true when both body and parameters have diverged', () => {
    expect(
      isDraftModified(
        { body: 'SELECT ?orig', parameters: [] },
        { body: 'SELECT ?edited', parameters: [cls] },
      ),
    ).toBe(true);
  });

  it('treats reordered parameters as modified — order is part of the loaded shape', () => {
    expect(
      isDraftModified(
        { body: '', parameters: [cls, country] },
        { body: '', parameters: [country, cls] },
      ),
    ).toBe(true);
  });
});
