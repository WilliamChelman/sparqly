import type { DiffResponse } from '../models/diff-response';

export function computeTotalsLine(result: DiffResponse): string | null {
  if (result.kind === 'grouped') {
    let added = 0;
    let removed = 0;
    for (const h of result.hunked.hunks) {
      added += h.added;
      removed += h.removed;
    }
    return summaryLine(result.hunked.totals, added, removed);
  }
  if (result.kind === 'tabular') {
    return summaryLine(
      result.totals,
      result.diff.added.length,
      result.diff.removed.length,
    );
  }
  return null;
}

function summaryLine(
  totals: { left: number; right: number },
  added: number,
  removed: number,
): string {
  return `left=${totals.left} right=${totals.right} +${added} -${removed}`;
}
