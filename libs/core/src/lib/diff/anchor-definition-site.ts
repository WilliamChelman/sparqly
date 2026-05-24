import { DataFactory, type Store } from 'n3';
import {
  triplePatternKey,
  type SourceRecord,
  type SourceRecordSidecar,
} from '../sources';

/** Earliest annotated line per file where the anchor's triples are asserted. */
export function anchorDefinitionSite(
  store: Store,
  anchorIri: string,
  sidecar: SourceRecordSidecar,
): SourceRecord[] {
  const subject = DataFactory.namedNode(anchorIri);
  const byFile = new Map<string, { line?: number; endLine?: number }>();

  for (const q of store.getQuads(subject, null, null, null)) {
    const key = triplePatternKey(q.subject, q.predicate, q.object);
    const records = sidecar.get(key);
    if (records === undefined) continue;
    for (const rec of records) {
      const existing = byFile.get(rec.file);
      if (
        existing === undefined ||
        (rec.line !== undefined &&
          (existing.line === undefined || rec.line < existing.line))
      ) {
        byFile.set(rec.file, { line: rec.line, endLine: rec.endLine });
      }
    }
  }

  const out: SourceRecord[] = [];
  for (const [file, { line, endLine }] of byFile) {
    const record: SourceRecord = { file };
    if (line !== undefined) record.line = line;
    if (endLine !== undefined) record.endLine = endLine;
    out.push(record);
  }
  out.sort((a, b) =>
    a.file !== b.file ? (a.file < b.file ? -1 : 1) : (a.line ?? 0) - (b.line ?? 0),
  );
  return out;
}
