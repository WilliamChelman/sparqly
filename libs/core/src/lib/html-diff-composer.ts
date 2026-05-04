import { basename } from 'node:path';
import type { RdfDiffResult, SourceRecord } from './diff';
import { displaySourcePath } from './source-path-display';
import type { SnippetReadResult } from './source-snippet-reader';

/**
 * Pre-fetched snippets keyed by `${file}:${line}`. The composer is a pure
 * function over (diff, perSideRecords, snippetsByRecord, options); the CLI
 * populates the map by calling the **Source-file snippet** reader for each
 * record with a `line`. Records whose key is absent or whose value is an
 * `unavailable` result render a degraded note instead of a `<pre>` block.
 */
export type HtmlDiffSnippets = ReadonlyMap<string, SnippetReadResult>;

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
  snippetsByRecord: HtmlDiffSnippets,
  options: HtmlDiffComposerOptions,
): string {
  const { cwd } = options;
  const removed = diff.removed.map((s) =>
    renderHunk(
      'removed',
      s,
      perSideRecords.left.get(s) ?? [],
      cwd,
      snippetsByRecord,
    ),
  );
  const added = diff.added.map((s) =>
    renderHunk(
      'added',
      s,
      perSideRecords.right.get(s) ?? [],
      cwd,
      snippetsByRecord,
    ),
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
  snippets: HtmlDiffSnippets,
): string {
  const marker = side === 'removed' ? '-' : '+';
  const records_html =
    records.length === 0
      ? ''
      : '<ul class="records">\n' +
        records.map((r) => renderRecord(r, cwd, snippets)).join('') +
        '</ul>\n';
  return (
    `<article class="hunk ${side}">\n` +
    `<pre class="statement">${escapeHtml(`${marker} ${statement}`)}</pre>\n` +
    records_html +
    '</article>\n'
  );
}

function renderRecord(
  record: SourceRecord,
  cwd: string,
  snippets: HtmlDiffSnippets,
): string {
  const { absolutePath, displayPath } = displaySourcePath(record.file, cwd);
  const base = basename(absolutePath);
  const anchorId =
    record.line === undefined ? base : `${base}-L${record.line}`;
  const displayText =
    record.line === undefined ? displayPath : `${displayPath}:${record.line}`;
  const link =
    `<a href="${escapeAttr(record.file)}">${escapeHtml(displayText)}</a>`;

  const body =
    record.line === undefined
      ? `<span class="note">(line not available)</span>`
      : renderSnippetBody(record.file, record.line, snippets);

  return (
    `<li class="record" id="${escapeAttr(anchorId)}">` +
    link +
    body +
    `</li>\n`
  );
}

function renderSnippetBody(
  file: string,
  line: number,
  snippets: HtmlDiffSnippets,
): string {
  const entry = snippets.get(`${file}:${line}`);
  if (entry === undefined || entry.kind === 'unavailable') {
    return `<span class="note">(source file unavailable)</span>`;
  }
  return renderSnippet(entry.startLine, entry.focalLine, entry.lines);
}

function renderSnippet(
  startLine: number,
  focalLine: number,
  lines: readonly string[],
): string {
  const rows = lines.map((src, i) => {
    const lineNo = startLine + i;
    const isFocal = lineNo === focalLine;
    const cls = isFocal ? 'line focal' : 'line';
    const style = isFocal ? ' style="background:#fff7c2"' : '';
    return (
      `<span class="${cls}"${style}>` +
      `<span class="gutter">${lineNo}</span>` +
      ` ${escapeHtml(src)}` +
      `</span>`
    );
  });
  return (
    `<pre class="snippet" data-focal="${focalLine}"><code>` +
    rows.join('\n') +
    `</code></pre>`
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
.note{color:#888;font-style:italic;margin-left:.5rem}
.snippet{margin:.25rem 0 .5rem;padding:.5rem;background:#fff;border:1px solid #e5e5e5;border-radius:3px;overflow-x:auto;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.8125rem;line-height:1.4}
.snippet .line{display:block}
.snippet .gutter{display:inline-block;width:3ch;text-align:right;color:#888;user-select:none;margin-right:.75rem;border-right:1px solid #eee;padding-right:.5rem}
.snippet .focal{font-weight:600}
`;
