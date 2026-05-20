import { shortenNQuadLine } from 'common';
import { displaySourcePath, type SourceRecord } from '../sources';
import type { FormatRdfDiffOptions, RdfDiffResult } from './diff';

/**
 * Renders the `# --- removed ---` / `# --- added ---` body of the `turtle`
 * diff format. Split out of {@link import('./diff').formatRdfDiff} so `diff.ts`
 * stays under the `max-lines` budget; the summary comment is still prepended
 * by the caller.
 */
export function renderTurtleDiffBlocks(
  diff: RdfDiffResult,
  options: FormatRdfDiffOptions,
): string {
  const prefixes = options.prefixes ?? {};
  const cwd = options.cwd;
  const leftRecords = options.sourceRecords?.left;
  const rightRecords = options.sourceRecords?.right;
  return (
    renderTurtleDiffBlock('removed', diff.removed, prefixes, leftRecords, cwd) +
    renderTurtleDiffBlock('added', diff.added, prefixes, rightRecords, cwd)
  );
}

function renderTurtleDiffBlock(
  label: 'removed' | 'added',
  statements: readonly string[],
  prefixes: Record<string, string>,
  records: Map<string, SourceRecord[]> | undefined,
  cwd: string | undefined,
): string {
  const header = `# --- ${label} ---\n`;
  if (statements.length === 0) return header;

  const usedPrefixes = pickPrefixesUsedInStatements(statements, prefixes);
  let body = '';
  const prefixEntries = Object.entries(usedPrefixes).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const [name, iri] of prefixEntries) {
    body += `@prefix ${name}: <${iri}> .\n`;
  }
  if (prefixEntries.length > 0) body += '\n';

  for (const s of statements) {
    if (records !== undefined && cwd !== undefined) {
      const recs = records.get(s) ?? [];
      for (const rec of recs) {
        const { displayPath } = displaySourcePath(rec.file, cwd);
        const tail = rec.line !== undefined ? `:${rec.line}` : '';
        body += `# from ${displayPath}${tail}\n`;
      }
    }
    body += `${shortenNQuadLine(s, { prefixes })}\n`;
  }
  return header + body;
}

function pickPrefixesUsedInStatements(
  statements: readonly string[],
  prefixes: Record<string, string>,
): Record<string, string> {
  const entries = Object.entries(prefixes);
  if (entries.length === 0) return {};
  const out: Record<string, string> = {};
  for (const s of statements) {
    for (const [name, iri] of entries) {
      if (out[name] !== undefined) continue;
      if (s.includes(`<${iri}`)) out[name] = iri;
    }
    if (Object.keys(out).length === entries.length) break;
  }
  return out;
}
