import { err, ok, type Result } from 'neverthrow';
import type { TabularBlankNodeError } from './errors';
import { tabularRowKey, type TabularRow } from './tabular-row-key';

export interface TabularDiffEntry {
  /**
   * One representative row for the bag-key. `count` is the absolute net
   * delta — direction is encoded by which block (`added` / `removed`) holds
   * the entry. A row that appears 3× left and 5× right contributes one entry
   * to `added` with `count: 2`.
   */
  row: TabularRow;
  count: number;
}

export interface TabularDiffResult {
  added: TabularDiffEntry[];
  removed: TabularDiffEntry[];
  /**
   * Per-side total occurrences — the raw row count returned by each side's
   * SELECT (sum of bag multiplicities), not the number of distinct rows.
   */
  totals: { left: number; right: number };
}

/**
 * Bag-difference two arrays of bindings rows under lexical term equality.
 * Variables list defines the projection the bag-key spans; mismatches in
 * unrelated variable names are the caller's responsibility (the CLI rejects
 * mismatched variable-name *sets* before calling here).
 *
 * Each block is sorted lexicographically by canonical key so output is
 * deterministic regardless of source order.
 */
export function tabularDiff(
  leftRows: ReadonlyArray<TabularRow>,
  rightRows: ReadonlyArray<TabularRow>,
  variables: ReadonlyArray<string>,
): Result<TabularDiffResult, TabularBlankNodeError> {
  const leftCounts = countRows(leftRows, variables);
  if (leftCounts.isErr()) return err(leftCounts.error);
  const rightCounts = countRows(rightRows, variables);
  if (rightCounts.isErr()) return err(rightCounts.error);

  const added: TabularDiffEntry[] = [];
  const removed: TabularDiffEntry[] = [];

  const allKeys = new Set<string>([
    ...leftCounts.value.keys(),
    ...rightCounts.value.keys(),
  ]);
  const sortedKeys = [...allKeys].sort();
  for (const key of sortedKeys) {
    const left = leftCounts.value.get(key);
    const right = rightCounts.value.get(key);
    const leftCount = left?.count ?? 0;
    const rightCount = right?.count ?? 0;
    const net = rightCount - leftCount;
    if (net === 0) continue;
    if (net > 0) {
      const row = right?.row ?? left?.row;
      if (row === undefined) continue;
      added.push({ row, count: net });
    } else {
      const row = left?.row ?? right?.row;
      if (row === undefined) continue;
      removed.push({ row, count: -net });
    }
  }
  return ok({
    added,
    removed,
    totals: { left: leftRows.length, right: rightRows.length },
  });
}

interface CountedRow {
  row: TabularRow;
  count: number;
}

function countRows(
  rows: ReadonlyArray<TabularRow>,
  variables: ReadonlyArray<string>,
): Result<Map<string, CountedRow>, TabularBlankNodeError> {
  const out = new Map<string, CountedRow>();
  for (const row of rows) {
    const keyResult = tabularRowKey(row, variables);
    if (keyResult.isErr()) return err(keyResult.error);
    const entry = out.get(keyResult.value);
    if (entry === undefined) out.set(keyResult.value, { row, count: 1 });
    else entry.count += 1;
  }
  return ok(out);
}
