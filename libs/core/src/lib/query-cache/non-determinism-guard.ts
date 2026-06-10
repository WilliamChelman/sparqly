/**
 * The non-deterministic SPARQL functions whose presence makes a query's answer
 * vary between runs (ADR-0054): the current timestamp, a random number, and the
 * two UUID minters. Matched as whole tokens, case-insensitively.
 */
const NON_DETERMINISTIC_TOKENS = /\b(?:NOW|RAND|STRUUID|UUID)\b/i;

/**
 * Whether `query` should bypass the Query cache because it mentions a
 * non-deterministic function (ADR-0054, #416). A pure, conservative token scan:
 * it word-matches `NOW`/`RAND`/`UUID`/`STRUUID` anywhere in the text, with no
 * attempt to exclude string literals or comments. The bluntness is the point —
 * a false positive only forfeits a caching opportunity, while never serving a
 * stale or wrong answer.
 */
export function queryIsNonDeterministic(query: string): boolean {
  return NON_DETERMINISTIC_TOKENS.test(query);
}
