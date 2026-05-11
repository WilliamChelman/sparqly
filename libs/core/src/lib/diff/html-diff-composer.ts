import { basename } from 'node:path';
import { bestPrefixEntryFor, shortenNQuadLine } from 'common';
import type { SourceRecord } from './diff';
import type {
  BnodePathStep,
  Hunk,
  HunkedRdfDiff,
  HunkLine,
} from './group-rdf-diff-by-entity';
import type { SnippetReadResult } from './source-snippet-reader';

export type HtmlDiffSnippets = ReadonlyMap<string, SnippetReadResult>;

export interface HtmlDiffComposerOptions {
  cwd: string;
  context?: number;
  prefixes: Record<string, string>;
}

/**
 * Render an `html` diff: a single self-contained HTML document with an
 * inline `<style>` block, no JavaScript, and no external resources. Output
 * groups changed triples into hunks anchored on the affected named entity
 * (or orphan bnode tree) and renders three sections — `Changed`, `Removed`,
 * `Added` — in display order. Pure function over its inputs.
 */
export function composeHtmlDiff(
  hunked: HunkedRdfDiff,
  snippets: HtmlDiffSnippets,
  options: HtmlDiffComposerOptions,
): string {
  const totalRemoved = countLines(hunked, '-');
  const totalAdded = countLines(hunked, '+');
  const prefixEntries = Object.entries(options.prefixes);
  const renderSection = (
    label: 'Changed' | 'Removed' | 'Added',
    cls: 'changed' | 'removed' | 'added',
    hunks: readonly Hunk[],
  ): string =>
    `<section class="block ${cls}">\n<h2>${label}</h2>\n` +
    (hunks.length === 0
      ? '<p class="empty">(none)</p>\n'
      : hunks.map((h) => renderHunk(h, prefixEntries, snippets, options)).join('')) +
    '</section>\n';

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
    `<p class="summary">left=${hunked.totals.left} right=${hunked.totals.right} +${totalAdded} −${totalRemoved}</p>\n` +
    '</header>\n' +
    renderSection('Changed', 'changed', hunked.changed) +
    renderSection('Removed', 'removed', hunked.removed) +
    renderSection('Added', 'added', hunked.added) +
    '</body>\n' +
    '</html>\n'
  );
}

function renderHunk(
  hunk: Hunk,
  prefixEntries: ReadonlyArray<[string, string]>,
  snippets: HtmlDiffSnippets,
  options: HtmlDiffComposerOptions,
): string {
  const anchorDisplay = renderAnchor(hunk, prefixEntries);
  return (
    `<article class="hunk ${hunk.state}${hunk.orphan === true ? ' orphan' : ''}">\n` +
    renderHunkHeader(hunk, prefixEntries) +
    renderHunkBody(hunk, anchorDisplay, options.prefixes) +
    renderHunkSnippets(hunk, snippets) +
    '</article>\n'
  );
}

interface DedupedRecord {
  file: string;
  startLine: number;
  endLine: number;
  anchorId: string;
}

function dedupeRecordsByFileLine(hunk: Hunk): DedupedRecord[] {
  const ranges: DedupedRecord[] = [];
  for (const r of [...hunk.sourceRecords.left, ...hunk.sourceRecords.right]) {
    if (r.line === undefined) continue;
    ranges.push({
      file: r.file,
      startLine: r.line,
      endLine: r.endLine ?? r.line,
      anchorId: `${basename(r.file)}-L${r.line}`,
    });
  }
  return ranges.filter((b, i) =>
    !ranges.some(
      (a, j) =>
        i !== j &&
        a.file === b.file &&
        a.startLine <= b.startLine &&
        a.endLine >= b.endLine &&
        // Tie-break: when ranges are identical, keep the first occurrence.
        !(a.startLine === b.startLine && a.endLine === b.endLine && j > i),
    ),
  );
}

function renderHunkSnippets(hunk: Hunk, snippets: HtmlDiffSnippets): string {
  const records = dedupeRecordsByFileLine(hunk);
  if (records.length === 0) return '';
  const blocks = records.map((rec) => renderSnippetBlock(rec, snippets));
  return `<div class="hunk-snippets">\n${blocks.join('')}</div>\n`;
}

function renderSnippetBlock(
  rec: DedupedRecord,
  snippets: HtmlDiffSnippets,
): string {
  const entry = snippets.get(snippetKey(rec.file, rec.startLine, rec.endLine));
  const label =
    rec.startLine === rec.endLine
      ? `${basename(rec.file)}:${rec.startLine}`
      : `${basename(rec.file)}:${rec.startLine}-${rec.endLine}`;
  const header =
    `<div class="snippet-header" id="${escapeAttr(rec.anchorId)}">` +
    `<a href="${escapeAttr(rec.file)}">${escapeHtml(label)}</a>` +
    '</div>\n';
  if (entry === undefined || entry.kind === 'unavailable') {
    return (
      header +
      '<div class="snippet-note">(source file unavailable)</div>\n'
    );
  }
  return (
    header +
    renderSnippetPre(entry.startLine, entry.focalStart, entry.focalEnd, entry.lines)
  );
}

function renderSnippetPre(
  startLine: number,
  focalStart: number,
  focalEnd: number,
  lines: readonly string[],
): string {
  const rows = lines.map((src, i) => {
    const lineNo = startLine + i;
    const isFocal = lineNo >= focalStart && lineNo <= focalEnd;
    const cls = isFocal ? 'line focal' : 'line';
    const style = isFocal ? ' style="background:#fff7c2"' : '';
    return (
      `<span class="${cls}"${style}>` +
      `<span class="gutter">${lineNo}</span>` +
      ` ${escapeHtml(src)}` +
      `</span>`
    );
  });
  const dataFocal =
    focalStart === focalEnd ? `${focalStart}` : `${focalStart}-${focalEnd}`;
  return (
    `<pre class="snippet" data-focal="${dataFocal}"><code>` +
    rows.join('\n') +
    `</code></pre>\n`
  );
}

export function snippetKey(file: string, startLine: number, endLine: number): string {
  return startLine === endLine
    ? `${file}:${startLine}`
    : `${file}:${startLine}-${endLine}`;
}

const OVERFLOW_LINE_THRESHOLD = 20;

function renderHunkBody(
  hunk: Hunk,
  anchorDisplay: string,
  prefixes: Record<string, string>,
): string {
  if (hunk.lines.length === 0) return '';
  const items = clusterLinesIntoPairs(hunk.lines).map((cluster) => {
    if (cluster.length === 2) {
      return (
        '<div class="pair">\n' +
        cluster
          .map((line) => renderHunkLine(line, anchorDisplay, prefixes))
          .join('') +
        '</div>\n'
      );
    }
    return renderHunkLine(cluster[0], anchorDisplay, prefixes);
  });
  const body = `<div class="hunk-body">\n${items.join('')}</div>\n`;
  if (hunk.lines.length <= OVERFLOW_LINE_THRESHOLD) return body;
  return (
    '<details class="hunk-overflow">\n' +
    `<summary>Show ${hunk.lines.length} more</summary>\n` +
    body +
    '</details>\n'
  );
}

function clusterLinesIntoPairs(
  lines: readonly HunkLine[],
): HunkLine[][] {
  const result: HunkLine[][] = [];
  let i = 0;
  while (i < lines.length) {
    const a = lines[i];
    const b = lines[i + 1];
    if (
      b !== undefined &&
      a.side === '-' &&
      b.side === '+' &&
      a.subjectPath === b.subjectPath &&
      a.predicate === b.predicate
    ) {
      result.push([a, b]);
      i += 2;
    } else {
      result.push([a]);
      i += 1;
    }
  }
  return result;
}

function renderHunkLine(
  line: HunkLine,
  anchorDisplay: string,
  prefixes: Record<string, string>,
): string {
  const sideClass = line.side === '-' ? 'line-removed' : 'line-added';
  const body = formatLineBody(line, anchorDisplay, prefixes);
  return (
    `<div class="line ${sideClass}">` +
    `<span class="marker">${line.side}</span>` +
    ` <span class="text">${escapeHtml(body)}</span>` +
    '</div>\n'
  );
}

function formatLineBody(
  line: HunkLine,
  anchorDisplay: string,
  prefixes: Record<string, string>,
): string {
  if (line.bnodePath !== undefined && line.bnodePath.length > 0) {
    return renderAbsorbedBnodeLine(line, prefixes);
  }
  const shortened = shortenNQuadLine(line.nquad, { prefixes });
  const prefix = `${anchorDisplay} `;
  return shortened.startsWith(prefix)
    ? shortened.slice(prefix.length)
    : shortened;
}

function renderAbsorbedBnodeLine(
  line: HunkLine,
  prefixes: Record<string, string>,
): string {
  const prefixEntries = Object.entries(prefixes);
  const path = line.bnodePath as BnodePathStep[];
  const segments = path.map((step) => {
    if (step.identityIsBlank) {
      return step.identityValue;
    }
    const idPredicateCurie = curieOrIri(
      step.identityPredicate ?? '',
      prefixEntries,
    );
    const idValueDisplay = renderIdentityValue(step.identityValue, prefixEntries);
    return `[${idPredicateCurie} ${idValueDisplay}]`;
  });
  const shortened = shortenNQuadLine(line.nquad, { prefixes });
  const firstSpace = shortened.indexOf(' ');
  const tail = firstSpace >= 0 ? shortened.slice(firstSpace + 1) : shortened;
  return `${segments.join(' / ')} / ${tail}`;
}

function renderIdentityValue(
  value: string,
  prefixEntries: ReadonlyArray<[string, string]>,
): string {
  if (value.startsWith('"') || value.startsWith('_:') || value.startsWith('<')) {
    return value;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    return curieOrIri(value, prefixEntries);
  }
  return value;
}

function renderHunkHeader(
  hunk: Hunk,
  prefixEntries: ReadonlyArray<[string, string]>,
): string {
  const chipRow = renderChipRow(hunk);
  return (
    '<header class="hunk-header">\n' +
    renderHunkTitle(hunk, prefixEntries) +
    chipRow +
    '</header>\n'
  );
}

function renderHunkTitle(
  hunk: Hunk,
  prefixEntries: ReadonlyArray<[string, string]>,
): string {
  const anchorDisplay = renderAnchor(hunk, prefixEntries);
  const typeSuffix =
    hunk.rdfType !== undefined
      ? `  (${curieOrIri(hunk.rdfType, prefixEntries)})`
      : '';
  const orphanSuffix = hunk.orphan === true ? '  (orphan)' : '';
  const stateSuffix = hunk.state === 'changed' ? '' : `  (${hunk.state})`;
  const counts = `[-${hunk.removed} +${hunk.added}]`;
  const titleText = `${anchorDisplay}${typeSuffix}${orphanSuffix}${stateSuffix}  ${counts}`;
  return `<div class="hunk-title">${escapeHtml(titleText)}</div>\n`;
}

function renderChipRow(hunk: Hunk): string {
  const left = hunk.sourceRecords.left;
  const right = hunk.sourceRecords.right;
  if (left.length === 0 && right.length === 0) return '';
  const chips: string[] = [];
  for (const r of left) chips.push(renderChip(r, 'left'));
  for (const r of right) chips.push(renderChip(r, 'right'));
  return `<div class="hunk-chips">\n${chips.join('')}</div>\n`;
}

function renderChip(record: SourceRecord, side: 'left' | 'right'): string {
  const base = basename(record.file);
  const anchorId = record.line === undefined ? base : `${base}-L${record.line}`;
  const text = record.line === undefined ? base : `${base}:${record.line}`;
  return (
    `<a class="chip chip-${side}" href="#${escapeAttr(anchorId)}">` +
    escapeHtml(text) +
    '</a>\n'
  );
}

function renderAnchor(
  hunk: Hunk,
  prefixEntries: ReadonlyArray<[string, string]>,
): string {
  if (hunk.orphan === true) return hunk.anchor;
  return curieOrIri(hunk.anchor, prefixEntries);
}

function curieOrIri(
  iri: string,
  entries: ReadonlyArray<[string, string]>,
): string {
  const match = bestPrefixEntryFor(iri, entries);
  if (match === undefined) return `<${iri}>`;
  const [name, ns] = match;
  return `${name}:${iri.slice(ns.length)}`;
}

function countLines(hunked: HunkedRdfDiff, side: '-' | '+'): number {
  let n = 0;
  for (const h of [...hunked.changed, ...hunked.removed, ...hunked.added]) {
    n += side === '-' ? h.removed : h.added;
  }
  return n;
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const INLINE_STYLE = `body{font:14px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;margin:0;padding:1.5rem;color:#222}
header{margin-bottom:1.5rem}
h1{font-size:1.25rem;margin:0 0 .25rem}
.summary{margin:0;color:#555;font-family:ui-monospace,Menlo,Consolas,monospace}
.block{margin-bottom:1.5rem}
.block h2{font-size:1rem;margin:0 0 .5rem}
.empty{color:#888;font-style:italic;margin:0}
.hunk{border-left:3px solid #ccc;padding:.5rem .75rem;margin:.5rem 0;background:#fafafa}
.hunk.removed{border-left-color:#c33;background:#fff4f4}
.hunk.added{border-left-color:#393;background:#f4fff4}
.hunk.changed{border-left-color:#06c;background:#f4f8ff}
.hunk-header{margin:0 0 .25rem}
.hunk-title{font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:600}
.hunk-chips{margin:.25rem 0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.8125rem;line-height:1.8}
.chip{display:inline-block;padding:0 .5rem;margin:0 .25rem .125rem 0;border-radius:3px;text-decoration:none;color:#222;border:1px solid transparent}
.chip:hover{text-decoration:underline}
.chip-left{background:#fee;border-color:#f4caca}
.chip-right{background:#efe;border-color:#cce8cc}
.hunk-body{margin:.5rem 0 0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.875rem;line-height:1.5}
.line{display:block;padding:0 .25rem;white-space:pre-wrap;word-break:break-all}
.line-removed{background:#fff4f4}
.line-added{background:#f4fff4}
.marker{display:inline-block;width:1ch;text-align:center;color:#888;user-select:none}
.line-removed .marker{color:#c33}
.line-added .marker{color:#393}
.pair{border-left:2px solid #d8d8d8;margin:.125rem 0;padding-left:.25rem}
.hunk-snippets{margin-top:.5rem}
.snippet-header{margin:.25rem 0 .125rem;font-size:.8125rem;font-family:ui-monospace,Menlo,Consolas,monospace;color:#06c}
.snippet-header a{color:inherit;text-decoration:none}
.snippet-header a:hover{text-decoration:underline}
.snippet-note{color:#888;font-style:italic;font-size:.8125rem;margin:.25rem 0}
.snippet{margin:.125rem 0 .5rem;padding:.5rem;background:#fff;border:1px solid #e5e5e5;border-radius:3px;overflow-x:auto;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.8125rem;line-height:1.4}
.snippet .line{display:block}
.snippet .gutter{display:inline-block;width:3ch;text-align:right;color:#888;user-select:none;margin-right:.75rem;border-right:1px solid #eee;padding-right:.5rem}
.snippet .focal{font-weight:600}
`;
