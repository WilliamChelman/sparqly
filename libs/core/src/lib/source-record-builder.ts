import { DataFactory, type Quad } from 'n3';

const { namedNode, blankNode, literal, quad } = DataFactory;

const XSD_INTEGER = namedNode('http://www.w3.org/2001/XMLSchema#integer');

export interface AnnotationPredicateIris {
  source: string;
  file: string;
  line: string;
}

export const DEFAULT_ANNOTATION_PREDICATE_IRIS: AnnotationPredicateIris = {
  source: 'urn:sparqly:source',
  file: 'urn:sparqly:file',
  line: 'urn:sparqly:line',
};

export interface BuildSourceRecordInput {
  asserted: Quad;
  filePath: string;
  line?: number;
  predicates: AnnotationPredicateIris;
}

export function buildSourceRecord(input: BuildSourceRecordInput): Quad[] {
  const quotedSubject = quad(
    input.asserted.subject,
    input.asserted.predicate,
    input.asserted.object,
  );
  const record = blankNode();
  const out: Quad[] = [
    quad(quotedSubject, namedNode(input.predicates.source), record),
    quad(record, namedNode(input.predicates.file), namedNode(toFileIri(input.filePath))),
  ];
  if (input.line !== undefined) {
    out.push(
      quad(record, namedNode(input.predicates.line), literal(String(input.line), XSD_INTEGER)),
    );
  }
  return out;
}

function toFileIri(absPath: string): string {
  return absPath.startsWith('/') ? `file://${absPath}` : `file:///${absPath}`;
}
