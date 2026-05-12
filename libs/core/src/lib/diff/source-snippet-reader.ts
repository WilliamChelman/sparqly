import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * One **Source-file snippet**: a span of context lines covering a focal
 * range, read from disk at HTML diff render time. The single filesystem
 * boundary in the html rendering pipeline.
 */
export interface SourceSnippet {
  kind: 'snippet';
  /** 1-based line number of the first line in `lines`. */
  startLine: number;
  /** 1-based line number of the first focal (highlighted) source line. */
  focalStart: number;
  /** 1-based inclusive line number of the last focal (highlighted) line. */
  focalEnd: number;
  /** Source-file lines, in order, exactly as read from disk. */
  lines: string[];
}

/**
 * Why a snippet could not be produced. The composer renders a degraded
 * note instead of a `<pre>` block.
 */
export interface SnippetUnavailable {
  kind: 'unavailable';
  reason: 'missing' | 'not-a-file' | 'beyond-eof' | 'empty';
}

export type SnippetReadResult = SourceSnippet | SnippetUnavailable;

/** One requested focal range within a source file (1-based, inclusive). */
export interface FocalRange {
  focalStart: number;
  focalEnd: number;
}

function isValidFocal(r: FocalRange): boolean {
  return (
    Number.isInteger(r.focalStart) &&
    Number.isInteger(r.focalEnd) &&
    r.focalStart >= 1 &&
    r.focalEnd >= r.focalStart
  );
}

/**
 * Consume `linesIter` until the highest requested upper bound
 * (`max(focalEnd) + context`) is reached and stop, buffering only the
 * lines any requested window needs. Returns one {@link SnippetReadResult}
 * per entry of `ranges`, in the same order. Pure over the iterator: the
 * caller is responsible for opening and closing the underlying stream.
 * Exists so the streaming contract — "read up to the union upper bound,
 * then stop" — is verifiable without filesystem I/O.
 */
export async function readSnippetsFromLines(
  linesIter: AsyncIterable<string>,
  ranges: ReadonlyArray<FocalRange>,
  context: number,
): Promise<SnippetReadResult[]> {
  const valid = ranges.filter(isValidFocal);

  // Nothing readable was asked for: leave the stream untouched.
  if (valid.length === 0) {
    return ranges.map(() => ({ kind: 'unavailable', reason: 'beyond-eof' }));
  }

  const globalLower = Math.max(
    1,
    Math.min(...valid.map((r) => r.focalStart - context)),
  );
  const globalUpper = Math.max(...valid.map((r) => r.focalEnd + context));

  const buffer: string[] = []; // lines [globalLower .. min(globalUpper, eof)]
  let lastSeen = 0;
  const iterator = linesIter[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      lastSeen += 1;
      if (lastSeen >= globalLower && lastSeen <= globalUpper) {
        buffer.push(next.value);
      }
      if (lastSeen >= globalUpper) break;
    }
  } finally {
    if (typeof iterator.return === 'function') {
      await iterator.return(undefined);
    }
  }

  return ranges.map((r) => sliceSnippet(r, buffer, globalLower, lastSeen, context));
}

function sliceSnippet(
  r: FocalRange,
  buffer: readonly string[],
  bufferStartLine: number,
  lastSeen: number,
  context: number,
): SnippetReadResult {
  if (!isValidFocal(r)) return { kind: 'unavailable', reason: 'beyond-eof' };
  if (lastSeen === 0) return { kind: 'unavailable', reason: 'empty' };
  if (r.focalStart > lastSeen) return { kind: 'unavailable', reason: 'beyond-eof' };
  const lower = Math.max(1, r.focalStart - context);
  const upper = Math.min(r.focalEnd + context, lastSeen);
  return {
    kind: 'snippet',
    startLine: lower,
    focalStart: r.focalStart,
    focalEnd: r.focalEnd,
    lines: buffer.slice(lower - bufferStartLine, upper - bufferStartLine + 1),
  };
}

/**
 * Single-range convenience over {@link readSnippetsFromLines}. Returns the
 * window `[focalStart - context, focalEnd + context]`, truncated at file
 * bounds.
 */
export async function readSnippetFromLines(
  linesIter: AsyncIterable<string>,
  focalStart: number,
  focalEnd: number,
  context: number,
): Promise<SnippetReadResult> {
  const [result] = await readSnippetsFromLines(
    linesIter,
    [{ focalStart, focalEnd }],
    context,
  );
  return result;
}

/**
 * Read `absolutePath` once and return one {@link SnippetReadResult} per
 * entry of `ranges`, in order. Streams via `readline` and stops as soon as
 * the highest requested upper bound is reached, so multi-megabyte sources
 * whose focal ranges are near the top are not penalized. The single
 * filesystem boundary in the html rendering and `serve` snippet pipelines.
 */
export async function readSourceSnippets(
  absolutePath: string,
  ranges: ReadonlyArray<FocalRange>,
  context: number,
): Promise<SnippetReadResult[]> {
  const stream = createReadStream(absolutePath, { encoding: 'utf8' });
  try {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    return await readSnippetsFromLines(rl, ranges, context);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return ranges.map(() => ({ kind: 'unavailable', reason: 'missing' }));
    }
    if (code === 'EISDIR') {
      return ranges.map(() => ({ kind: 'unavailable', reason: 'not-a-file' }));
    }
    throw err;
  } finally {
    stream.destroy();
  }
}

/** Single-range convenience over {@link readSourceSnippets}. */
export async function readSourceSnippet(
  absolutePath: string,
  focalStart: number,
  focalEnd: number,
  context: number,
): Promise<SnippetReadResult> {
  const [result] = await readSourceSnippets(
    absolutePath,
    [{ focalStart, focalEnd }],
    context,
  );
  return result;
}
