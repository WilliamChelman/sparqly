import { describe, expect, it } from 'vitest';
import { substitute } from './substitute';

describe('substitute', () => {
  it('returns the body verbatim when the parameter list is empty', () => {
    const body = 'SELECT * WHERE { ?s ?p ?o }';
    const result = substitute({ body, parameters: [] }, {});
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(body);
    }
  });
});
