import type { Hunk, SourceRecord } from '../services/diff.service';

export interface SnippetRange {
  file: string;
  side: 'left' | 'right';
  focalStart: number;
  focalEnd: number;
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
 * strictly between the prior `focalEnd` and the next `focalStart`; a gap
 * `≤ context` triggers a merge.
 */
function mergeNearby(ranges: SnippetRange[], context: number): SnippetRange[] {
  const sorted = [...ranges].sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.side !== b.side) return a.side < b.side ? -1 : 1;
    return a.focalStart - b.focalStart;
  });
  const out: SnippetRange[] = [];
  for (const r of sorted) {
    const prev = out[out.length - 1];
    if (
      prev !== undefined &&
      prev.file === r.file &&
      prev.side === r.side &&
      r.focalStart - prev.focalEnd - 1 <= context
    ) {
      out[out.length - 1] = {
        ...prev,
        focalEnd: Math.max(prev.focalEnd, r.focalEnd),
      };
      continue;
    }
    out.push(r);
  }
  return out;
}

function dropEnclosed(ranges: SnippetRange[]): SnippetRange[] {
  return ranges.filter(
    (b, i) =>
      !ranges.some(
        (a, j) =>
          i !== j &&
          a.file === b.file &&
          a.side === b.side &&
          a.focalStart <= b.focalStart &&
          a.focalEnd >= b.focalEnd &&
          !(
            a.focalStart === b.focalStart &&
            a.focalEnd === b.focalEnd &&
            j > i
          ),
      ),
  );
}

function toRange(
  record: SourceRecord,
  side: 'left' | 'right',
): SnippetRange | undefined {
  if (record.line === undefined) return undefined;
  return {
    file: record.file,
    side,
    focalStart: record.line,
    focalEnd: record.endLine ?? record.line,
  };
}
