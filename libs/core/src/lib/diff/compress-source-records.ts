import type { SourceRecord } from '../sources';

export interface CompressedSourceRecords {
  /** Absolute `file://` IRI of the source file. */
  file: string;
  /**
   * 1-based line numbers, deduplicated and sorted ascending. Empty when no
   * record for this file carried a line (e.g. JSON-LD / RDF/XML annotators
   * per ADR-0006).
   */
  lines: number[];
}

/**
 * Group **Source records** by file IRI. Files appear in first-seen order;
 * each file's `lines` are deduplicated and sorted ascending. Records without
 * a line still produce a group (with an empty `lines`), so a renderer can
 * decide whether to fall back to file-only display.
 *
 * Pure helper; used by the renderers for `human` and (later) `html` diff
 * output, where lines for the same file are folded into one
 * `path:line[,line...]` token.
 */
export function compressSourceRecords(
  records: readonly SourceRecord[],
): CompressedSourceRecords[] {
  const order: string[] = [];
  const linesByFile = new Map<string, Set<number>>();
  for (const r of records) {
    if (!linesByFile.has(r.file)) {
      linesByFile.set(r.file, new Set());
      order.push(r.file);
    }
    if (r.line !== undefined) linesByFile.get(r.file)?.add(r.line);
  }
  return order.map((file) => ({
    file,
    lines: Array.from(linesByFile.get(file) ?? []).sort((a, b) => a - b),
  }));
}
