/**
 * The title value for the diff page: the two side source tokens joined by an
 * arrow, collapsed to a single token when both sides resolve to the same one
 * (mirroring the describe-this affordance precedent), and reduced to whatever
 * is present when a side is empty (ADR-0053).
 */
export function diffTitleValue(left: string, right: string): string {
  const tokens = [left, right].filter((token) => token.length > 0);
  return [...new Set(tokens)].join(' → ');
}
