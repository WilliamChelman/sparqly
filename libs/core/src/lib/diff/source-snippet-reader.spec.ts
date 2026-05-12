import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readSnippetFromLines,
  readSnippetsFromLines,
  readSourceSnippet,
  readSourceSnippets,
} from './source-snippet-reader';

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'sparqly-snippet-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function fixture(name: string, body: string): Promise<string> {
  const path = join(scratch, name);
  await writeFile(path, body, 'utf8');
  return path;
}

describe('readSourceSnippet', () => {
  it('returns context lines around a mid-file focal line', async () => {
    const path = await fixture(
      'a.ttl',
      'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\n',
    );

    const out = await readSourceSnippet(path, 5, 5, 2);

    expect(out).toEqual({
      kind: 'snippet',
      startLine: 3,
      focalStart: 5,
      focalEnd: 5,
      lines: ['L3', 'L4', 'L5', 'L6', 'L7'],
    });
  });

  it('returns the window [focalStart - context, focalEnd + context] for a multi-line focal range', async () => {
    const path = await fixture(
      'a.ttl',
      'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\n',
    );

    const out = await readSourceSnippet(path, 4, 6, 1);

    expect(out).toEqual({
      kind: 'snippet',
      startLine: 3,
      focalStart: 4,
      focalEnd: 6,
      lines: ['L3', 'L4', 'L5', 'L6', 'L7'],
    });
  });

  it('truncates the top window when the focal line is at the top of the file', async () => {
    const path = await fixture('a.ttl', 'L1\nL2\nL3\nL4\nL5\n');

    const out = await readSourceSnippet(path, 1, 1, 3);

    expect(out).toEqual({
      kind: 'snippet',
      startLine: 1,
      focalStart: 1,
      focalEnd: 1,
      lines: ['L1', 'L2', 'L3', 'L4'],
    });
  });

  it('truncates the bottom window when the focal line is at the bottom of the file', async () => {
    const path = await fixture('a.ttl', 'L1\nL2\nL3\nL4\nL5\n');

    const out = await readSourceSnippet(path, 5, 5, 3);

    expect(out).toEqual({
      kind: 'snippet',
      startLine: 2,
      focalStart: 5,
      focalEnd: 5,
      lines: ['L2', 'L3', 'L4', 'L5'],
    });
  });

  it('truncates both ends when the requested context exceeds the file length', async () => {
    const path = await fixture('a.ttl', 'L1\nL2\nL3\n');

    const out = await readSourceSnippet(path, 2, 2, 10);

    expect(out).toEqual({
      kind: 'snippet',
      startLine: 1,
      focalStart: 2,
      focalEnd: 2,
      lines: ['L1', 'L2', 'L3'],
    });
  });

  it('returns context=0 → focal line only', async () => {
    const path = await fixture('a.ttl', 'L1\nL2\nL3\n');

    const out = await readSourceSnippet(path, 2, 2, 0);

    expect(out).toEqual({
      kind: 'snippet',
      startLine: 2,
      focalStart: 2,
      focalEnd: 2,
      lines: ['L2'],
    });
  });

  it('reports `empty` for a zero-byte file', async () => {
    const path = await fixture('empty.ttl', '');

    const out = await readSourceSnippet(path, 1, 1, 3);

    expect(out).toEqual({ kind: 'unavailable', reason: 'empty' });
  });

  it('reports `beyond-eof` when the focal line is past the last line', async () => {
    const path = await fixture('a.ttl', 'L1\nL2\nL3\n');

    const out = await readSourceSnippet(path, 99, 99, 3);

    expect(out).toEqual({ kind: 'unavailable', reason: 'beyond-eof' });
  });

  it('reports `missing` when the file does not exist', async () => {
    const out = await readSourceSnippet(
      join(scratch, 'nope.ttl'),
      1,
      1,
      3,
    );

    expect(out).toEqual({ kind: 'unavailable', reason: 'missing' });
  });

  it('reports `not-a-file` when the path is a directory', async () => {
    const out = await readSourceSnippet(scratch, 1, 1, 3);

    expect(out).toEqual({ kind: 'unavailable', reason: 'not-a-file' });
  });

  it('streams: stops pulling lines after `focalLine + context` (does not iterate the rest of the source)', async () => {
    let pulled = 0;
    async function* countingLines(): AsyncGenerator<string> {
      for (let i = 1; i <= 1_000_000; i += 1) {
        pulled += 1;
        yield `L${i}`;
      }
    }

    const out = await readSnippetFromLines(countingLines(), 5, 5, 2);

    expect(out).toEqual({
      kind: 'snippet',
      startLine: 3,
      focalStart: 5,
      focalEnd: 5,
      lines: ['L3', 'L4', 'L5', 'L6', 'L7'],
    });
    // Stopped at line 7 — never pulled line 8 or beyond.
    expect(pulled).toBe(7);
  });

  it('preserves UTF-8 multibyte content in lines', async () => {
    const path = await fixture(
      'utf8.ttl',
      'こんにちは\n世界\n🌍 emoji line\n',
    );

    const out = await readSourceSnippet(path, 2, 2, 1);

    expect(out).toEqual({
      kind: 'snippet',
      startLine: 1,
      focalStart: 2,
      focalEnd: 2,
      lines: ['こんにちは', '世界', '🌍 emoji line'],
    });
  });
});

describe('readSourceSnippets', () => {
  it('returns one snippet per requested focal range, in request order, from a single read', async () => {
    const path = await fixture(
      'a.ttl',
      'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\n',
    );

    const out = await readSourceSnippets(
      path,
      [
        { focalStart: 7, focalEnd: 8 },
        { focalStart: 2, focalEnd: 2 },
      ],
      1,
    );

    expect(out).toEqual([
      {
        kind: 'snippet',
        startLine: 6,
        focalStart: 7,
        focalEnd: 8,
        lines: ['L6', 'L7', 'L8', 'L9'],
      },
      {
        kind: 'snippet',
        startLine: 1,
        focalStart: 2,
        focalEnd: 2,
        lines: ['L1', 'L2', 'L3'],
      },
    ]);
  });

  it('streams: stops pulling lines after the highest requested upper bound across all ranges', async () => {
    let pulled = 0;
    async function* countingLines(): AsyncGenerator<string> {
      for (let i = 1; i <= 1_000_000; i += 1) {
        pulled += 1;
        yield `L${i}`;
      }
    }

    const out = await readSnippetsFromLines(
      countingLines(),
      [
        { focalStart: 3, focalEnd: 3 },
        { focalStart: 10, focalEnd: 11 },
      ],
      2,
    );

    expect(out).toEqual([
      { kind: 'snippet', startLine: 1, focalStart: 3, focalEnd: 3, lines: ['L1', 'L2', 'L3', 'L4', 'L5'] },
      { kind: 'snippet', startLine: 8, focalStart: 10, focalEnd: 11, lines: ['L8', 'L9', 'L10', 'L11', 'L12', 'L13'] },
    ]);
    // Highest upper bound is 11 + context(2) = 13 — never pulled line 14.
    expect(pulled).toBe(13);
  });

  it('reports `beyond-eof` for ranges past EOF while still returning in-bounds ranges', async () => {
    const path = await fixture('a.ttl', 'L1\nL2\nL3\n');

    const out = await readSourceSnippets(
      path,
      [
        { focalStart: 1, focalEnd: 1 },
        { focalStart: 99, focalEnd: 99 },
      ],
      0,
    );

    expect(out).toEqual([
      { kind: 'snippet', startLine: 1, focalStart: 1, focalEnd: 1, lines: ['L1'] },
      { kind: 'unavailable', reason: 'beyond-eof' },
    ]);
  });

  it('reports `empty` for every requested range on a zero-byte file', async () => {
    const path = await fixture('empty.ttl', '');

    const out = await readSourceSnippets(
      path,
      [
        { focalStart: 1, focalEnd: 1 },
        { focalStart: 4, focalEnd: 6 },
      ],
      2,
    );

    expect(out).toEqual([
      { kind: 'unavailable', reason: 'empty' },
      { kind: 'unavailable', reason: 'empty' },
    ]);
  });

  it('reports `missing` for every requested range when the file does not exist', async () => {
    const out = await readSourceSnippets(
      join(scratch, 'nope.ttl'),
      [
        { focalStart: 1, focalEnd: 1 },
        { focalStart: 2, focalEnd: 2 },
      ],
      1,
    );

    expect(out).toEqual([
      { kind: 'unavailable', reason: 'missing' },
      { kind: 'unavailable', reason: 'missing' },
    ]);
  });

  it('returns an empty array when no ranges are requested (no read)', async () => {
    const path = await fixture('a.ttl', 'L1\nL2\nL3\n');

    expect(await readSourceSnippets(path, [], 2)).toEqual([]);
  });
});
