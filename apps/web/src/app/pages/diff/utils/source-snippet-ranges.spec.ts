import {
  collectAnchorSourceRanges,
  collectSnippetRanges,
  outerEnd,
  outerStart,
} from './source-snippet-ranges';
import type { Hunk, SourceRecord } from '../services/diff.service';

function hunkWith(
  records: { left?: SourceRecord[]; right?: SourceRecord[] } = {},
): Hunk {
  return {
    anchor: 'http://example.org/s',
    state: 'changed',
    removed: 0,
    added: 0,
    lines: [],
    sourceRecords: {
      left: records.left ?? [],
      right: records.right ?? [],
    },
  };
}

describe('collectSnippetRanges', () => {
  it('returns [] for a hunk with no source records', () => {
    expect(collectSnippetRanges(hunkWith(), 3)).toEqual([]);
  });

  it('emits one range per single-line source record', () => {
    const ranges = collectSnippetRanges(
      hunkWith({ left: [{ file: 'file:///tmp/a.ttl', line: 7 }] }),
      3,
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0].file).toBe('file:///tmp/a.ttl');
    expect(ranges[0].side).toBe('left');
    expect(ranges[0].records).toEqual([{ file: 'file:///tmp/a.ttl', line: 7 }]);
    expect(outerStart(ranges[0])).toBe(7);
    expect(outerEnd(ranges[0])).toBe(7);
  });

  it('merges two adjacent same-side records into one range carrying both records', () => {
    const ranges = collectSnippetRanges(
      hunkWith({
        left: [
          { file: 'file:///tmp/a.ttl', line: 17 },
          { file: 'file:///tmp/a.ttl', line: 18 },
        ],
      }),
      3,
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0].records).toEqual([
      { file: 'file:///tmp/a.ttl', line: 17 },
      { file: 'file:///tmp/a.ttl', line: 18 },
    ]);
    expect(outerStart(ranges[0])).toBe(17);
    expect(outerEnd(ranges[0])).toBe(18);
  });

  it('keeps two same-side records separate when their gap exceeds the context window', () => {
    // gap = 22 - 17 - 1 = 4 lines; with context=3, the windows would NOT visually touch.
    const ranges = collectSnippetRanges(
      hunkWith({
        left: [
          { file: 'file:///tmp/a.ttl', line: 17 },
          { file: 'file:///tmp/a.ttl', line: 22 },
        ],
      }),
      3,
    );
    expect(ranges).toHaveLength(2);
    expect(ranges.map((r) => [outerStart(r), outerEnd(r)])).toEqual([
      [17, 17],
      [22, 22],
    ]);
  });

  it('does not merge adjacent-line records that live in different files', () => {
    const ranges = collectSnippetRanges(
      hunkWith({
        left: [
          { file: 'file:///tmp/a.ttl', line: 17 },
          { file: 'file:///tmp/b.ttl', line: 18 },
        ],
      }),
      3,
    );
    expect(ranges).toHaveLength(2);
    expect(new Set(ranges.map((r) => r.file))).toEqual(
      new Set(['file:///tmp/a.ttl', 'file:///tmp/b.ttl']),
    );
  });

  it('does not merge adjacent-line records that live on different sides', () => {
    const ranges = collectSnippetRanges(
      hunkWith({
        left: [{ file: 'file:///tmp/a.ttl', line: 17 }],
        right: [{ file: 'file:///tmp/a.ttl', line: 18 }],
      }),
      3,
    );
    expect(ranges).toHaveLength(2);
    expect(new Set(ranges.map((r) => r.side))).toEqual(
      new Set(['left', 'right']),
    );
  });

  it('measures gap from outer end, so multi-line ranges 17-19 + 23-25 merge under context=3', () => {
    // gap = 23 - 19 - 1 = 3 lines; with context=3, the windows touch.
    const ranges = collectSnippetRanges(
      hunkWith({
        left: [
          { file: 'file:///tmp/a.ttl', line: 17, endLine: 19 },
          { file: 'file:///tmp/a.ttl', line: 23, endLine: 25 },
        ],
      }),
      3,
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0].records).toEqual([
      { file: 'file:///tmp/a.ttl', line: 17, endLine: 19 },
      { file: 'file:///tmp/a.ttl', line: 23, endLine: 25 },
    ]);
    expect(outerStart(ranges[0])).toBe(17);
    expect(outerEnd(ranges[0])).toBe(25);
  });

  it('chains contiguous records into one range covering every line', () => {
    const ranges = collectSnippetRanges(
      hunkWith({
        left: [
          { file: 'file:///tmp/a.ttl', line: 17 },
          { file: 'file:///tmp/a.ttl', line: 18 },
          { file: 'file:///tmp/a.ttl', line: 19 },
        ],
      }),
      1,
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0].records.map((r) => r.line)).toEqual([17, 18, 19]);
    expect(outerStart(ranges[0])).toBe(17);
    expect(outerEnd(ranges[0])).toBe(19);
  });

  it('drops a record whose [start..end] range is fully enclosed by another on the same file+side', () => {
    const ranges = collectSnippetRanges(
      hunkWith({
        left: [
          { file: 'file:///tmp/a.ttl', line: 11, endLine: 16 },
          { file: 'file:///tmp/a.ttl', line: 12 },
          { file: 'file:///tmp/a.ttl', line: 13 },
          { file: 'file:///tmp/a.ttl', line: 14 },
        ],
      }),
      0,
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0].records).toEqual([
      { file: 'file:///tmp/a.ttl', line: 11, endLine: 16 },
    ]);
    expect(outerStart(ranges[0])).toBe(11);
    expect(outerEnd(ranges[0])).toBe(16);
  });

  it('regression: gap-1 records 15 and 17 under context=3 merge into one range carrying both records, so the gap line 16 is not part of any record range', () => {
    // Reproduces the diff-01/diff-02 bug: ex:friends (line 15) and ex:family
    // (line 17+) merge into one snippet but the unchanged ex:spouces on line
    // 16 must not inherit a focal highlight.
    const ranges = collectSnippetRanges(
      hunkWith({
        left: [
          { file: 'file:///tmp/a.ttl', line: 15 },
          { file: 'file:///tmp/a.ttl', line: 17 },
        ],
      }),
      3,
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0].records.map((r) => r.line)).toEqual([15, 17]);
    expect(outerStart(ranges[0])).toBe(15);
    expect(outerEnd(ranges[0])).toBe(17);
    // The gap line (16) is not covered by any contributing record.
    const inRecord = ranges[0].records.some(
      (r) => r.line !== undefined && 16 >= r.line && 16 <= (r.endLine ?? r.line),
    );
    expect(inRecord).toBe(false);
  });
});

describe('collectAnchorSourceRanges', () => {
  it('returns [] when the hunk carries no anchorSource', () => {
    expect(collectAnchorSourceRanges(hunkWith(), 3)).toEqual([]);
  });

  it('emits one range per anchorSource record, tagged with its side', () => {
    const hunk: Hunk = {
      ...hunkWith(),
      anchorSource: {
        left: [{ file: 'file:///tmp/def.ttl', line: 4 }],
        right: [],
      },
    };
    const ranges = collectAnchorSourceRanges(hunk, 3);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].file).toBe('file:///tmp/def.ttl');
    expect(ranges[0].side).toBe('left');
    expect(ranges[0].records).toEqual([{ file: 'file:///tmp/def.ttl', line: 4 }]);
  });

  it('merges adjacent same-side definition-site records into one range carrying both records', () => {
    const hunk: Hunk = {
      ...hunkWith(),
      anchorSource: {
        left: [],
        right: [
          { file: 'file:///tmp/def.ttl', line: 8 },
          { file: 'file:///tmp/def.ttl', line: 9 },
        ],
      },
    };
    const ranges = collectAnchorSourceRanges(hunk, 3);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].side).toBe('right');
    expect(ranges[0].records).toEqual([
      { file: 'file:///tmp/def.ttl', line: 8 },
      { file: 'file:///tmp/def.ttl', line: 9 },
    ]);
    expect(outerStart(ranges[0])).toBe(8);
    expect(outerEnd(ranges[0])).toBe(9);
  });

  it('regression: two same-side anchor records with gap=1 merge into one range carrying both records', () => {
    const hunk: Hunk = {
      ...hunkWith(),
      anchorSource: {
        left: [
          { file: 'file:///tmp/def.ttl', line: 4 },
          { file: 'file:///tmp/def.ttl', line: 6 },
        ],
        right: [],
      },
    };
    const ranges = collectAnchorSourceRanges(hunk, 3);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].records.map((r) => r.line)).toEqual([4, 6]);
    const inRecord = ranges[0].records.some(
      (r) => r.line !== undefined && 5 >= r.line && 5 <= (r.endLine ?? r.line),
    );
    expect(inRecord).toBe(false);
  });
});
