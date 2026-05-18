import type { Hunk, SourceRecord } from '../services/diff.service';

export interface SnippetRange {
  file: string;
  side: 'left' | 'right';
  /**
   * Contributing **Source records** for this side of the snippet. Each
   * record's `[line, endLine ?? line]` is a focal sub-range; the renderer
   * paints those lines only — gap lines between merged records render as
   * plain context.
   */
  records: readonly SourceRecord[];
}

/** Outer start line — `min(records.line)`. */
export function outerStart(range: SnippetRange): number {
  let min = Number.POSITIVE_INFINITY;
  for (const r of range.records) {
    if (r.line !== undefined && r.line < min) min = r.line;
  }
  return min;
}

/** Outer end line — `max(records.endLine ?? records.line)`. */
export function outerEnd(range: SnippetRange): number {
  let max = Number.NEGATIVE_INFINITY;
  for (const r of range.records) {
    const end = r.endLine ?? r.line;
    if (end !== undefined && end > max) max = end;
  }
  return max;
}

export function collectSnippetRanges(
  hunk: Hunk,
  context: number,
): SnippetRange[] {
  return reduceRanges(
    rawRanges(hunk.sourceRecords.left, hunk.sourceRecords.right),
    context,
  );
}

/**
 * Snippet ranges for a hunk's **anchor definition site** — the muted
 * `defined here` snippets shown on a side that exists but contributed no
 * changed-line source records. Returns `[]` when the hunk carries no
 * `anchorSource`. Same merge/enclosure pipeline as {@link collectSnippetRanges}.
 */
export function collectAnchorSourceRanges(
  hunk: Hunk,
  context: number,
): SnippetRange[] {
  if (hunk.anchorSource === undefined) return [];
  return reduceRanges(
    rawRanges(hunk.anchorSource.left, hunk.anchorSource.right),
    context,
  );
}

function rawRanges(
  left: readonly SourceRecord[],
  right: readonly SourceRecord[],
): SnippetRange[] {
  const ranges: SnippetRange[] = [];
  for (const r of left) {
    const range = toRange(r, 'left');
    if (range !== undefined) ranges.push(range);
  }
  for (const r of right) {
    const range = toRange(r, 'right');
    if (range !== undefined) ranges.push(range);
  }
  return ranges;
}

function reduceRanges(ranges: SnippetRange[], context: number): SnippetRange[] {
  return mergeNearby(dropEnclosed(ranges), context);
}

/**
 * Two ranges on the same (file, side) whose context windows would visually
 * overlap are merged into one. Adjacency is measured as the count of lines
 * strictly between the prior outer end and the next outer start; a gap
 * `≤ context` triggers a merge. On merge, the resulting range concatenates
 * the contributing records — each record's focal sub-range stays distinct
 * so the renderer can leave gap lines as plain context.
 */
function mergeNearby(ranges: SnippetRange[], context: number): SnippetRange[] {
  const sorted = [...ranges].sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.side !== b.side) return a.side < b.side ? -1 : 1;
    return outerStart(a) - outerStart(b);
  });
  const out: SnippetRange[] = [];
  for (const r of sorted) {
    const prev = out[out.length - 1];
    if (
      prev !== undefined &&
      prev.file === r.file &&
      prev.side === r.side &&
      outerStart(r) - outerEnd(prev) - 1 <= context
    ) {
      out[out.length - 1] = {
        ...prev,
        records: [...prev.records, ...r.records],
      };
      continue;
    }
    out.push(r);
  }
  return out;
}

function dropEnclosed(ranges: SnippetRange[]): SnippetRange[] {
  return ranges.filter((b, i) => {
    const bStart = outerStart(b);
    const bEnd = outerEnd(b);
    return !ranges.some((a, j) => {
      if (i === j) return false;
      if (a.file !== b.file || a.side !== b.side) return false;
      const aStart = outerStart(a);
      const aEnd = outerEnd(a);
      if (aStart > bStart || aEnd < bEnd) return false;
      // Tie-break: when ranges are identical, keep the first occurrence.
      return !(aStart === bStart && aEnd === bEnd && j > i);
    });
  });
}

function toRange(
  record: SourceRecord,
  side: 'left' | 'right',
): SnippetRange | undefined {
  if (record.line === undefined) return undefined;
  return { file: record.file, side, records: [record] };
}
