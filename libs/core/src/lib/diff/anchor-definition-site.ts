import { DataFactory, type Quad, type Store } from 'n3';
import type { SourceRecord } from '../sources';
import {
  DEFAULT_ANNOTATION_PREDICATE_IRIS,
  type AnnotationPredicateIris,
} from '../sources';

/**
 * Given an in-memory {@link Store} and a named-entity IRI, return one
 * {@link SourceRecord} per distinct file the anchor's triples are annotated
 * from, each focused on that file's earliest annotated line of the anchor.
 *
 * Mirrors how the diff extracts source records from a side store: it scans
 * `sparqly:source` RDF-star annotations, keeps the ones whose quoted triple's
 * subject is the anchor IRI, and buckets by the annotation record's file. No
 * filesystem I/O and no `rdf:type` assumption — an untyped subject resolves by
 * its minimum annotated line just like a typed one.
 *
 * Returns an empty array when the anchor is absent from the store, or when the
 * store carries no `sparqly:source` annotations at all.
 */
export function anchorDefinitionSite(
  store: Store,
  anchorIri: string,
  predicates: AnnotationPredicateIris = DEFAULT_ANNOTATION_PREDICATE_IRIS,
): SourceRecord[] {
  const byFile = new Map<string, { line?: number; endLine?: number }>();

  for (const annotation of store.getQuads(null, null, null, null)) {
    if ((annotation.subject.termType as string) !== 'Quad') continue;
    if (annotation.predicate.value !== predicates.source) continue;

    const quoted = annotation.subject as unknown as Quad;
    if (quoted.subject.termType !== 'NamedNode') continue;
    if (quoted.subject.value !== anchorIri) continue;

    const recordNode = annotation.object;
    const fileQuads = store.getQuads(
      recordNode,
      DataFactory.namedNode(predicates.file),
      null,
      null,
    );
    if (fileQuads.length === 0) continue;
    const file = fileQuads[0].object.value;

    const lineQuads = store.getQuads(
      recordNode,
      DataFactory.namedNode(predicates.line),
      null,
      null,
    );
    const lineRaw = lineQuads[0]?.object.value;
    const line = lineRaw === undefined ? undefined : Number(lineRaw);

    const endLineQuads = store.getQuads(
      recordNode,
      DataFactory.namedNode(predicates.endLine),
      null,
      null,
    );
    const endLineRaw = endLineQuads[0]?.object.value;
    const endLine = endLineRaw === undefined ? undefined : Number(endLineRaw);

    const existing = byFile.get(file);
    if (
      existing === undefined ||
      (line !== undefined && (existing.line === undefined || line < existing.line))
    ) {
      byFile.set(file, { line, endLine });
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
