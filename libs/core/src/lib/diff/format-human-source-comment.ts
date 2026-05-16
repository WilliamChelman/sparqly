import { compressSourceRecords } from './compress-source-records';
import type { SourceRecord } from '../sources';
import { displaySourcePath } from '../sources';

/**
 * Render the trailing inline source-record comment for one `+` / `-` hunk in
 * `human` (and `rdf-patch`) diff output. Returns the empty string when there
 * are no records, so the caller can unconditionally append the result.
 *
 * Shape: ` # <displayPath>:<line>[,<line>...][; <displayPath2>:<line>...]`.
 * A file whose records carried no line falls back to bare `<displayPath>`.
 */
export function formatHumanSourceComment(
  records: readonly SourceRecord[],
  cwd: string,
): string {
  if (records.length === 0) return '';
  const groups = compressSourceRecords(records);
  const tokens = groups.map((g) => {
    const { displayPath } = displaySourcePath(g.file, cwd);
    if (g.lines.length === 0) return displayPath;
    return `${displayPath}:${g.lines.join(',')}`;
  });
  return ` # ${tokens.join('; ')}`;
}
