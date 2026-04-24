import { describe, expect, it } from 'vitest';
import type { SparqlRequest } from './sparql-protocol';

describe('SparqlRequest', () => {
  it('accepts a minimal query', () => {
    const req: SparqlRequest = { query: 'SELECT * WHERE { ?s ?p ?o }' };
    expect(req.query).toMatch(/SELECT/);
  });
});
