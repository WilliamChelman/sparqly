import type { Term } from 'n3';
import type { TabularDiffEntry, TabularDiffResult } from './tabular-diff';
import { UNBOUND_SENTINEL, type TabularRow } from './tabular-row-key';

export type TabularDiffFormat = 'human' | 'json';

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
  // human
  const parts: string[] = [];
  for (const e of diff.removed) parts.push(`- ${humanLine(e)}\n`);
  for (const e of diff.added) parts.push(`+ ${humanLine(e)}\n`);
  return parts.join('');
}

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
