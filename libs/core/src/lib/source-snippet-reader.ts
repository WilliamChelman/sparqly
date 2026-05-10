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

/**
 * Consume `linesIter` until line `focalEnd + context` is reached and stop.
 * Returns the window `[focalStart - context, focalEnd + context]`,
 * truncated at file bounds. Pure over the iterator: the caller is
 * responsible for opening and closing the underlying stream. Exists so the
 * streaming contract — "read up to focalEnd + context, then stop" — is
 * verifiable without filesystem I/O.
 */
export async function readSnippetFromLines(
  linesIter: AsyncIterable<string>,
  focalStart: number,
  focalEnd: number,
  context: number,
): Promise<SnippetReadResult> {
  if (
    focalStart < 1 ||
    !Number.isInteger(focalStart) ||
    !Number.isInteger(focalEnd) ||
    focalEnd < focalStart
  ) {
    return { kind: 'unavailable', reason: 'beyond-eof' };
  }
  const lower = Math.max(1, focalStart - context);
  const upper = focalEnd + context;

  const lines: string[] = [];
  let lastSeen = 0;
  const iterator = linesIter[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      lastSeen += 1;
      if (lastSeen >= lower && lastSeen <= upper) {
        lines.push(next.value);
      }
      if (lastSeen >= upper) break;
    }
  } finally {
    if (typeof iterator.return === 'function') {
      await iterator.return(undefined);
    }
  }

  if (lastSeen === 0) return { kind: 'unavailable', reason: 'empty' };
  if (focalStart > lastSeen) return { kind: 'unavailable', reason: 'beyond-eof' };

  return {
    kind: 'snippet',
    startLine: lower,
    focalStart,
    focalEnd,
    lines,
  };
}

/**
 * Read up to `focalEnd + context` lines from `absolutePath` and return the
 * window `[focalStart - context, focalEnd + context]` (truncated at file
 * bounds). The single filesystem boundary in the html rendering pipeline.
 * Streams via `readline` and stops as soon as the upper bound is reached,
 * so multi-megabyte sources whose focal range is near the top are not
 * penalized.
 */
export async function readSourceSnippet(
  absolutePath: string,
  focalStart: number,
  focalEnd: number,
  context: number,
): Promise<SnippetReadResult> {
  const stream = createReadStream(absolutePath, { encoding: 'utf8' });
  try {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    return await readSnippetFromLines(rl, focalStart, focalEnd, context);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { kind: 'unavailable', reason: 'missing' };
    if (code === 'EISDIR') return { kind: 'unavailable', reason: 'not-a-file' };
    throw err;
  } finally {
    stream.destroy();
  }
}
