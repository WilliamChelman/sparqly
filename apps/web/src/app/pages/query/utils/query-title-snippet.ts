/**
 * The leading, non-body part of a query: PREFIX/BASE declarations, comment
 * lines, and blank lines, in any order at the top of the buffer.
 */
function isPreamble(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length === 0 ||
    trimmed.startsWith('#') ||
    /^(PREFIX|BASE)\b/i.test(trimmed)
  );
}

/**
 * Derive a compact, title-friendly snippet of a SPARQL query body: skip the
 * leading PREFIX/BASE/comment/blank preamble, collapse whitespace, and take
 * the first ~40 characters of the real query (ADR-0053).
 */
const MAX_LEN = 40;

export function queryTitleSnippet(body: string): string {
  const lines = body.split('\n');
  let start = 0;
  while (start < lines.length && isPreamble(lines[start])) start++;
  const snippet = lines.slice(start).join(' ').replace(/\s+/g, ' ').trim();
  if (snippet.length <= MAX_LEN) return snippet;
  return `${snippet.slice(0, MAX_LEN).trimEnd()}…`;
}
