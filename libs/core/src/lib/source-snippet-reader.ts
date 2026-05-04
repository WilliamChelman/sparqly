import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * One **Source-file snippet**: a span of context lines centered on a focal
 * line, read from disk at HTML diff render time. The single filesystem
 * boundary in the html rendering pipeline.
 */
export interface SourceSnippet {
  kind: 'snippet';
  /** 1-based line number of the first line in `lines`. */
  startLine: number;
  /** 1-based line number of the focal (highlighted) source line. */
  focalLine: number;
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
 * Consume `linesIter` until line `focalLine + context` is reached and stop.
 * Returns the window `[focalLine - context, focalLine + context]`,
 * truncated at file bounds. Pure over the iterator: the caller is
 * responsible for opening and closing the underlying stream. Exists so the
 * streaming contract — "read up to focal + context, then stop" — is
 * verifiable without filesystem I/O.
 */
export async function readSnippetFromLines(
  linesIter: AsyncIterable<string>,
  focalLine: number,
  context: number,
): Promise<SnippetReadResult> {
  if (focalLine < 1 || !Number.isInteger(focalLine)) {
    return { kind: 'unavailable', reason: 'beyond-eof' };
  }
  const lower = Math.max(1, focalLine - context);
  const upper = focalLine + context;

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
  if (focalLine > lastSeen) return { kind: 'unavailable', reason: 'beyond-eof' };

  return {
    kind: 'snippet',
    startLine: lower,
    focalLine,
    lines,
  };
}

/**
 * Read up to `focalLine + context` lines from `absolutePath` and return the
 * window `[focalLine - context, focalLine + context]` (truncated at file
 * bounds). The single filesystem boundary in the html rendering pipeline.
 * Streams via `readline` and stops as soon as the upper bound is reached,
 * so multi-megabyte sources whose focal line is near the top are not
 * penalized.
 */
export async function readSourceSnippet(
  absolutePath: string,
  focalLine: number,
  context: number,
): Promise<SnippetReadResult> {
  const stream = createReadStream(absolutePath, { encoding: 'utf8' });
  try {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    return await readSnippetFromLines(rl, focalLine, context);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { kind: 'unavailable', reason: 'missing' };
    if (code === 'EISDIR') return { kind: 'unavailable', reason: 'not-a-file' };
    throw err;
  } finally {
    stream.destroy();
  }
}
