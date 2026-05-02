import { Parser as SparqlParser } from 'sparqljs';

export function validatePrefilter(query: string): void {
  const parsed = new SparqlParser().parse(query);
  if (parsed.type === 'update') {
    throw new Error(
      'UPDATE queries are not allowed as a prefilter; use SELECT or CONSTRUCT.',
    );
  }
  if (parsed.type === 'query') {
    if (parsed.queryType === 'ASK') {
      throw new Error(
        'ASK queries are not allowed as a prefilter; use SELECT or CONSTRUCT.',
      );
    }
    if (parsed.queryType === 'DESCRIBE') {
      throw new Error(
        'DESCRIBE queries are not allowed as a prefilter; use SELECT or CONSTRUCT.',
      );
    }
    if (parsed.queryType === 'SELECT') {
      assertSelectProjection(parsed.variables);
    }
  }
}

function assertSelectProjection(variables: ReadonlyArray<unknown>): void {
  const names: string[] = [];
  for (const v of variables) {
    const term = v as { termType?: string; value?: string };
    if (term?.termType !== 'Variable' || typeof term.value !== 'string') {
      throw new Error(
        'SELECT prefilter must project exactly {?s, ?p, ?o} or {?s, ?p, ?o, ?g} (no SELECT *, no expressions).',
      );
    }
    names.push(term.value);
  }
  const sorted = [...names].sort().join(',');
  if (sorted !== 'o,p,s' && sorted !== 'g,o,p,s') {
    throw new Error(
      'SELECT prefilter must project exactly {?s, ?p, ?o} or {?s, ?p, ?o, ?g}.',
    );
  }
}
