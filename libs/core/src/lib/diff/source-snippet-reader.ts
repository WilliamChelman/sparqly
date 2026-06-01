import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { GitPort } from '../sources/git/git-port';

/** A source-file snippet: focal range with context lines, read from disk. */
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

/** Read lines up to the highest focal upper bound, one result per requested range. */
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

/** Read source snippets from disk, streaming and stopping at the highest focal upper bound. */
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

/**
 * Yields the lines of an in-memory string, matching `readline`'s semantics:
 * a single trailing newline does not produce a final empty line, so line
 * numbering is identical to {@link readSourceSnippets}' disk read.
 */
async function* linesOfString(content: string): AsyncIterable<string> {
  const parts = content.split('\n');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  for (const line of parts) yield line;
}

/**
 * Read source snippets from a pinned git blob instead of the working tree
 * (ADR-0029 / ADR-0032). When a diff side is pinned to a ref, each
 * {@link SourceRecord}'s line numbers were computed against that ref's blob —
 * reading the working-tree file would mis-align the highlight whenever the
 * checkout differs from the pin. Returns `unavailable: 'missing'` for every
 * range when the blob is absent at `sha` (e.g. a shallow clone or gc'd object)
 * rather than silently falling back to disk.
 */
export async function readGitFileSnippets(
  gitPort: GitPort,
  repoRoot: string,
  sha: string,
  repoRelPath: string,
  ranges: ReadonlyArray<FocalRange>,
  context: number,
): Promise<SnippetReadResult[]> {
  const bytes = await gitPort.readFileAtSha(repoRoot, sha, repoRelPath);
  if (bytes === null) {
    return ranges.map(() => ({ kind: 'unavailable', reason: 'missing' }));
  }
  return readSnippetsFromLines(
    linesOfString(bytes.toString('utf8')),
    ranges,
    context,
  );
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
