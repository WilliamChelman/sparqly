import type { Term } from 'n3';
import type { TabularDiffEntry, TabularDiffResult } from './tabular-diff';
import { UNBOUND_SENTINEL, type TabularRow } from './tabular-row-key';

export type TabularDiffFormat = 'human' | 'json' | 'html';

export interface FormatTabularDiffOptions {
  /**
   * Projection variables in display order. `human` sorts inside the row
   * braces alphabetically (so the rendering is independent of which side's
   * projection order was passed); `json` preserves this order in `vars`.
   */
  variables: ReadonlyArray<string>;
}

interface RowJson {
  [variable: string]: TermJson;
}

interface TermJson {
  termType: string;
  value: string;
  datatype?: string;
  language?: string;
}

interface EntryJson {
  row: RowJson;
  count?: number;
}

export function formatTabularDiff(
  diff: TabularDiffResult,
  format: TabularDiffFormat,
  options: FormatTabularDiffOptions,
): string {
  if (format === 'json') {
    const json = {
      added: diff.added.map((e) => entryToJson(e, options.variables)),
      removed: diff.removed.map((e) => entryToJson(e, options.variables)),
      vars: [...options.variables],
    };
    return `${JSON.stringify(json)}\n`;
  }
  if (format === 'html') {
    return renderHtml(diff, options.variables);
  }
  // human
  const parts: string[] = [];
  for (const e of diff.removed) parts.push(`- ${humanLine(e)}\n`);
  for (const e of diff.added) parts.push(`+ ${humanLine(e)}\n`);
  return parts.join('');
}

function renderHtml(
  diff: TabularDiffResult,
  variables: ReadonlyArray<string>,
): string {
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
    '<h1>sparqly diff</h1>\n' +
    `<p class="summary">+${diff.added.length} −${diff.removed.length}</p>\n` +
    '</header>\n' +
    renderHtmlBlock('removed', 'Removed', diff.removed, variables) +
    renderHtmlBlock('added', 'Added', diff.added, variables) +
    '</body>\n' +
    '</html>\n'
  );
}

function renderHtmlBlock(
  side: 'removed' | 'added',
  heading: string,
  entries: ReadonlyArray<TabularDiffEntry>,
  variables: ReadonlyArray<string>,
): string {
  const body =
    entries.length === 0
      ? '<p class="empty">(none)</p>\n'
      : renderHtmlTable(side, entries, variables);
  return (
    `<section class="block ${side}">\n` +
    `<h2>${heading}</h2>\n` +
    body +
    '</section>\n'
  );
}

function renderHtmlTable(
  side: 'removed' | 'added',
  entries: ReadonlyArray<TabularDiffEntry>,
  variables: ReadonlyArray<string>,
): string {
  const headers = variables
    .map((name) => `<th>?${escapeHtml(name)}</th>`)
    .join('');
  const rows = entries
    .map((e) => {
      const cells = variables
        .map((name) => `<td>${escapeHtml(humanTerm(e.row[name]))}</td>`)
        .join('');
      return `<tr class="row ${side}">${cells}<td class="count">${e.count}</td></tr>\n`;
    })
    .join('');
  return (
    `<table class="tabular-diff ${side}">\n` +
    `<thead><tr>${headers}<th>count</th></tr></thead>\n` +
    `<tbody>\n${rows}</tbody>\n` +
    '</table>\n'
  );
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
table.tabular-diff{border-collapse:collapse;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.875rem}
table.tabular-diff th,table.tabular-diff td{border:1px solid #e5e5e5;padding:.25rem .5rem;text-align:left;vertical-align:top}
table.tabular-diff thead th{background:#f5f5f5;font-weight:600}
table.tabular-diff td.count{text-align:right;color:#555}
table.tabular-diff.removed tbody tr{background:#fff4f4}
table.tabular-diff.added tbody tr{background:#f4fff4}
`;

function humanLine(entry: TabularDiffEntry): string {
  const sortedNames = Object.keys(entry.row).sort();
  const inside = sortedNames
    .map((name) => `?${name}=${humanTerm(entry.row[name])}`)
    .join(', ');
  const tail = entry.count > 1 ? ` (×${entry.count})` : '';
  return `{${inside}}${tail}`;
}

function humanTerm(term: Term | undefined): string {
  if (term === undefined) return UNBOUND_SENTINEL;
  if (term.termType === 'NamedNode') return `<${term.value}>`;
  if (term.termType === 'BlankNode') return `_:${term.value}`;
  if (term.termType === 'Literal') {
    const lit = term as Term & {
      language?: string;
      datatype?: { value: string };
    };
    const lex = `"${escapeLiteral(term.value)}"`;
    if (lit.language && lit.language.length > 0) return `${lex}@${lit.language}`;
    if (
      lit.datatype &&
      lit.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string'
    ) {
      return `${lex}^^<${lit.datatype.value}>`;
    }
    return lex;
  }
  return term.value;
}

function escapeLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function entryToJson(
  entry: TabularDiffEntry,
  variables: ReadonlyArray<string>,
): EntryJson {
  const out: EntryJson = { row: rowToJson(entry.row, variables) };
  if (entry.count > 1) out.count = entry.count;
  return out;
}

function rowToJson(row: TabularRow, variables: ReadonlyArray<string>): RowJson {
  const out: RowJson = {};
  for (const name of variables) {
    const term = row[name];
    if (term === undefined) continue;
    out[name] = termToJson(term);
  }
  return out;
}

function termToJson(term: Term): TermJson {
  const out: TermJson = { termType: term.termType, value: term.value };
  if (term.termType === 'Literal') {
    const lit = term as Term & {
      language?: string;
      datatype?: { value: string };
    };
    if (lit.language && lit.language.length > 0) out.language = lit.language;
    if (lit.datatype && lit.datatype.value) out.datatype = lit.datatype.value;
  }
  return out;
}
