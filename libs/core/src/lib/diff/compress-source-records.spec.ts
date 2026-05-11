import { describe, expect, it } from 'vitest';
import { compressSourceRecords } from './compress-source-records';

describe('compressSourceRecords', () => {
  it('returns one group per record for a single record carrying a line', () => {
    expect(
      compressSourceRecords([{ file: 'file:///a/foo.ttl', line: 5 }]),
    ).toEqual([{ file: 'file:///a/foo.ttl', lines: [5] }]);
  });

  it('folds multiple records on the same file into one group, deduplicating and sorting lines', () => {
    expect(
      compressSourceRecords([
        { file: 'file:///a/foo.ttl', line: 12 },
        { file: 'file:///a/foo.ttl', line: 5 },
        { file: 'file:///a/foo.ttl', line: 12 },
      ]),
    ).toEqual([{ file: 'file:///a/foo.ttl', lines: [5, 12] }]);
  });

  it('keeps one group per distinct file, in first-seen order', () => {
    expect(
      compressSourceRecords([
        { file: 'file:///a/foo.ttl', line: 5 },
        { file: 'file:///a/bar.ttl', line: 3 },
        { file: 'file:///a/foo.ttl', line: 12 },
      ]),
    ).toEqual([
      { file: 'file:///a/foo.ttl', lines: [5, 12] },
      { file: 'file:///a/bar.ttl', lines: [3] },
    ]);
  });

  it('preserves a group with an empty `lines` for a file whose only record lacks a line', () => {
    expect(
      compressSourceRecords([
        { file: 'file:///a/foo.ttl' },
        { file: 'file:///a/bar.ttl', line: 3 },
      ]),
    ).toEqual([
      { file: 'file:///a/foo.ttl', lines: [] },
      { file: 'file:///a/bar.ttl', lines: [3] },
    ]);
  });

  it('returns an empty array for an empty input', () => {
    expect(compressSourceRecords([])).toEqual([]);
  });
});
