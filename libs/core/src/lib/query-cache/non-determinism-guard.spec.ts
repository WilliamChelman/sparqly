import { describe, expect, it } from 'vitest';
import { queryIsNonDeterministic } from './non-determinism-guard';

/**
 * The non-determinism guard (ADR-0054, #416) is a pure, conservative token scan:
 * a query whose text mentions a non-deterministic SPARQL function must never be
 * cached, because its answer changes between runs. The scan is deliberately
 * blunt — a false positive only costs a missed caching opportunity, never a
 * wrong answer — so a literal token even inside a string suppresses caching.
 */
describe('queryIsNonDeterministic', () => {
  it('flags a query that calls NOW()', () => {
    expect(
      queryIsNonDeterministic('SELECT (NOW() AS ?t) WHERE { ?s ?p ?o }'),
    ).toBe(true);
  });

  it('does not flag a plain deterministic query', () => {
    expect(queryIsNonDeterministic('SELECT * WHERE { ?s ?p ?o }')).toBe(false);
  });

  it.each(['RAND', 'UUID', 'STRUUID'])('flags a query that calls %s()', (fn) => {
    expect(queryIsNonDeterministic(`SELECT (${fn}() AS ?x) WHERE {}`)).toBe(
      true,
    );
  });

  it('matches case-insensitively (lowercase now())', () => {
    expect(queryIsNonDeterministic('SELECT (now() AS ?t) WHERE {}')).toBe(true);
  });

  it('does not flag a substring inside a longer identifier', () => {
    // `?knows` and `:randomized` embed the tokens but are not the functions;
    // word boundaries keep them deterministic.
    expect(
      queryIsNonDeterministic('SELECT ?knows WHERE { ?s :randomized ?knows }'),
    ).toBe(false);
  });

  it('conservatively flags a token that appears only inside a string literal', () => {
    // A false positive here forfeits caching for this one query — acceptable,
    // and far cheaper than parsing SPARQL to exclude literals.
    expect(
      queryIsNonDeterministic('SELECT * WHERE { ?s ?p "the time is NOW" }'),
    ).toBe(true);
  });
});
