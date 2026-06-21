/**
 * The non-deterministic SPARQL functions whose presence makes a query's answer
 * vary between runs (ADR-0054): the current timestamp, a random number, and the
 * two UUID minters.
 *
 * Matched as an actual function call — the name, then optional whitespace, then
 * an opening parenthesis — and only as a standalone token: a leading `(?<![:\w])`
 * rules out prefixed local names (`ex:nowPlaying`), prefix labels (`PREFIX uuid:`),
 * and longer identifiers, so only a genuine `NOW()`/`RAND()`/`UUID()`/`STRUUID()`
 * call trips the guard. Case-insensitive.
 */
const NON_DETERMINISTIC_CALL = /(?<![:\w])(?:NOW|RAND|STRUUID|UUID)\s*\(/i;

/**
 * Spans that are opaque to SPARQL evaluation — string literals (single/double
 * quoted, including the long triple-quoted forms), IRI references, and line
 * comments — where a function-like token is just text. Stripped before the scan
 * so e.g. `<http://ex/now()>` or `# uses NOW()` never count as a call.
 */
const OPAQUE_SPANS =
  /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|<[^<>"{}|^`\s]*>|#[^\n\r]*/g;

/**
 * Whether `query` should bypass the Query cache because it calls a
 * non-deterministic function (ADR-0054, #416). A pure, conservative scan: after
 * blanking string literals, IRIs, and comments, it looks for a standalone
 * `NOW`/`RAND`/`UUID`/`STRUUID` immediately applied with `(`. It stays
 * deliberately blunt elsewhere — a false positive only forfeits a caching
 * opportunity, while never serving a stale or wrong answer — but no longer trips
 * on the tokens merely appearing inside IRIs, prefixes, strings, or comments.
 */
export function queryIsNonDeterministic(query: string): boolean {
  const scannable = query.replace(OPAQUE_SPANS, ' ');
  return NON_DETERMINISTIC_CALL.test(scannable);
}
