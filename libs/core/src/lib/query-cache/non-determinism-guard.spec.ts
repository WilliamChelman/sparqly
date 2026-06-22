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

  it('flags a call written with whitespace before the parenthesis (NOW ())', () => {
    expect(
      queryIsNonDeterministic('SELECT (NOW () AS ?t) WHERE { ?s ?p ?o }'),
    ).toBe(true);
  });

  it('does not flag a token inside a string literal (no call parenthesis)', () => {
    // Only an actual function call (token immediately followed by `(`) trips the
    // guard, so a bare word in a string is not a false positive.
    expect(
      queryIsNonDeterministic('SELECT * WHERE { ?s ?p "the time is NOW" }'),
    ).toBe(false);
  });

  it('does not flag a token inside a prefixed local name (ex:nowPlaying)', () => {
    expect(
      queryIsNonDeterministic('SELECT * WHERE { ?s ?p ex:nowPlaying }'),
    ).toBe(false);
  });

  it('does not flag a token used as a prefix label (PREFIX uuid:)', () => {
    expect(
      queryIsNonDeterministic(
        'PREFIX uuid: <urn:uuid:> SELECT * WHERE { ?s ?p ?o }',
      ),
    ).toBe(false);
  });

  it('does not flag a token inside an IRI (<...now()...>)', () => {
    // The token sits inside an angle-bracket IRI, not as a bare function call.
    expect(
      queryIsNonDeterministic('SELECT * WHERE { ?s ?p <http://ex/now()> }'),
    ).toBe(false);
  });

  it('does not flag a token inside a line comment', () => {
    expect(
      queryIsNonDeterministic('# uses NOW() somewhere\nSELECT * WHERE {}'),
    ).toBe(false);
  });
});
