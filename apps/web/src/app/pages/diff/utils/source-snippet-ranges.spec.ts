import {
  collectAnchorSourceRanges,
  collectSnippetRanges,
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
    expect(ranges).toEqual([
      {
        file: 'file:///tmp/a.ttl',
        side: 'left',
        focalStart: 7,
        focalEnd: 7,
      },
    ]);
  });

  it('merges two adjacent same-side records into one range', () => {
    const ranges = collectSnippetRanges(
      hunkWith({
        left: [
          { file: 'file:///tmp/a.ttl', line: 17 },
          { file: 'file:///tmp/a.ttl', line: 18 },
        ],
      }),
      3,
    );
    expect(ranges).toEqual([
      {
        file: 'file:///tmp/a.ttl',
        side: 'left',
        focalStart: 17,
        focalEnd: 18,
      },
    ]);
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
    expect(ranges.map((r) => [r.focalStart, r.focalEnd])).toEqual([
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

  it('measures gap from focalEnd, so multi-line ranges 17-19 + 23-25 merge under context=3', () => {
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
    expect(ranges[0].focalStart).toBe(17);
    expect(ranges[0].focalEnd).toBe(25);
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
    expect(ranges[0].focalStart).toBe(17);
    expect(ranges[0].focalEnd).toBe(19);
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
    expect(ranges).toEqual([
      {
        file: 'file:///tmp/a.ttl',
        side: 'left',
        focalStart: 11,
        focalEnd: 16,
      },
    ]);
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
    expect(collectAnchorSourceRanges(hunk, 3)).toEqual([
      {
        file: 'file:///tmp/def.ttl',
        side: 'left',
        focalStart: 4,
        focalEnd: 4,
      },
    ]);
  });

  it('merges adjacent same-side definition-site records like changed-line ranges do', () => {
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
    expect(collectAnchorSourceRanges(hunk, 3)).toEqual([
      {
        file: 'file:///tmp/def.ttl',
        side: 'right',
        focalStart: 8,
        focalEnd: 9,
      },
    ]);
  });
});
