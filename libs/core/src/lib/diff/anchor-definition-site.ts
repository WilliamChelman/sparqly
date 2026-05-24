import { DataFactory, type Store } from 'n3';
import {
  triplePatternKey,
  type SourceRecord,
  type SourceRecordSidecar,
} from '../sources';

/**
 * Given an in-memory {@link Store} and a named-entity IRI, return one
 * {@link SourceRecord} per distinct file the anchor's triples are annotated
 * from, each focused on that file's earliest annotated line of the anchor.
 *
 * Reads provenance exclusively from the loader-attached
 * {@link SourceRecordSidecar}: for every asserted triple in the store whose
 * subject is the anchor, the function looks up records under the triple's
 * graph-agnostic pattern key and buckets by file, keeping the smallest line
 * per file.
 *
 * Returns an empty array when the anchor is absent from the store, or when
 * the sidecar has no records for any of its triples.
 */
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
