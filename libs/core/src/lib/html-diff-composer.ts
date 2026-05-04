import { basename } from 'node:path';
import type { RdfDiffResult, SourceRecord } from './diff';
import { displaySourcePath } from './source-path-display';

/**
 * One pre-fetched **Source-file snippet**, keyed in
 * {@link HtmlDiffSnippets} by `${file}:${line ?? ''}`. Empty in the MVP slice
 * — the next slice will populate it from the snippet reader.
 */
export interface HtmlDiffSnippet {
  /** 1-based line number of the first line in `lines`. */
  startLine: number;
  /** 1-based line number of the focal (highlighted) source line. */
  focalLine: number;
  /** Source-file lines, in order, exactly as read from disk. */
  lines: string[];
}

/**
 * Pre-fetched snippets keyed by `${file}:${line ?? ''}`. Empty Map in the MVP
 * slice; the composer is a pure function over (diff, perSideRecords,
 * snippetsByRecord, options) so the next slice can populate this from the
 * snippet reader without changing the composer's signature.
 */
export type HtmlDiffSnippets = ReadonlyMap<string, HtmlDiffSnippet>;

export interface HtmlDiffComposerOptions {
  /** Working directory for path display. */
  cwd: string;
  /**
   * Number of context lines around each focal line. Plumbed through but
   * unused while {@link HtmlDiffSnippets} is empty.
   */
  context?: number;
}

export interface HtmlDiffPerSideRecords {
  left: ReadonlyMap<string, SourceRecord[]>;
  right: ReadonlyMap<string, SourceRecord[]>;
}

/**
 * Render an `html` diff: a single self-contained HTML document with an
 * inline `<style>` block, no JavaScript, and no external resources. Output
 * is a unified `removed` then `added` flat list mirroring the structural
 * shape of the other diff formats. Each hunk shows the canonical N-Quad
 * statement plus one entry per {@link SourceRecord} carrying the file
 * reference (display path relative to `cwd`, `href` absolute) and an anchor
 * id `<basename>-L<line>` (or `<basename>` when no line) for future
 * deep-linking. Pure function over its inputs.
 */
export function composeHtmlDiff(
  diff: RdfDiffResult,
  perSideRecords: HtmlDiffPerSideRecords,
  _snippetsByRecord: HtmlDiffSnippets,
  options: HtmlDiffComposerOptions,
): string {
  const { cwd } = options;
  const removed = diff.removed.map((s) =>
    renderHunk('removed', s, perSideRecords.left.get(s) ?? [], cwd),
  );
  const added = diff.added.map((s) =>
    renderHunk('added', s, perSideRecords.right.get(s) ?? [], cwd),
  );

  return (
    '<!doctype html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<title>sparqly diff</title>\n' +
    '<style>\n' +
    INLINE_STYLE +
    '</style>\n' +
    '</head>\n' +
    '<body>\n' +
    '<header>\n' +
    `<h1>sparqly diff</h1>\n` +
    `<p class="summary">+${diff.added.length} −${diff.removed.length}</p>\n` +
    '</header>\n' +
    '<section class="block removed">\n' +
    '<h2>Removed</h2>\n' +
    (removed.length === 0 ? '<p class="empty">(none)</p>\n' : removed.join('')) +
    '</section>\n' +
    '<section class="block added">\n' +
    '<h2>Added</h2>\n' +
    (added.length === 0 ? '<p class="empty">(none)</p>\n' : added.join('')) +
    '</section>\n' +
    '</body>\n' +
    '</html>\n'
  );
}

function renderHunk(
  side: 'removed' | 'added',
  statement: string,
  records: readonly SourceRecord[],
  cwd: string,
): string {
  const marker = side === 'removed' ? '-' : '+';
  const records_html =
    records.length === 0
      ? ''
      : '<ul class="records">\n' +
        records.map((r) => renderRecord(r, cwd)).join('') +
        '</ul>\n';
  return (
    `<article class="hunk ${side}">\n` +
    `<pre class="statement">${escapeHtml(`${marker} ${statement}`)}</pre>\n` +
    records_html +
    '</article>\n'
  );
}

function renderRecord(record: SourceRecord, cwd: string): string {
  const { absolutePath, displayPath } = displaySourcePath(record.file, cwd);
  const base = basename(absolutePath);
  const anchorId =
    record.line === undefined ? base : `${base}-L${record.line}`;
  const displayText =
    record.line === undefined ? displayPath : `${displayPath}:${record.line}`;
  return (
    `<li class="record" id="${escapeAttr(anchorId)}">` +
    `<a href="${escapeAttr(record.file)}">${escapeHtml(displayText)}</a>` +
    `</li>\n`
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

const INLINE_STYLE = `body{font:14px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;margin:0;padding:1.5rem;color:#222}
header{margin-bottom:1.5rem}
h1{font-size:1.25rem;margin:0 0 .25rem}
.summary{margin:0;color:#555;font-family:ui-monospace,Menlo,Consolas,monospace}
.block{margin-bottom:1.5rem}
.block h2{font-size:1rem;margin:0 0 .5rem}
.hunk{border-left:3px solid #ccc;padding:.5rem .75rem;margin:.25rem 0;background:#fafafa}
.hunk.removed{border-left-color:#c33;background:#fff4f4}
.hunk.added{border-left-color:#393;background:#f4fff4}
.statement{margin:0;font-family:ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-all}
.records{margin:.5rem 0 0;padding:0;list-style:none;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.875rem}
.record{margin:.125rem 0}
.record a{color:#06c;text-decoration:none}
.record a:hover{text-decoration:underline}
.empty{color:#888;font-style:italic;margin:0}
`;
