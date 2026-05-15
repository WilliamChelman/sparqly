import { DataFactory, type Quad } from 'n3';

const { namedNode, blankNode, literal, quad } = DataFactory;

const XSD_INTEGER = namedNode('http://www.w3.org/2001/XMLSchema#integer');

export interface AnnotationPredicateIris {
  source: string;
  file: string;
  line: string;
  endLine: string;
  /** Git-pinned-source provenance (ADR-0029, issue #273 slice 2). */
  gitRef: string;
  /** Git-pinned-source provenance (ADR-0029, issue #273 slice 2). */
  gitSha: string;
}

export const DEFAULT_ANNOTATION_PREDICATE_IRIS: AnnotationPredicateIris = {
  source: 'urn:sparqly:source',
  file: 'urn:sparqly:file',
  line: 'urn:sparqly:line',
  endLine: 'urn:sparqly:endLine',
  gitRef: 'urn:sparqly:gitRef',
  gitSha: 'urn:sparqly:gitSha',
};

export interface BuildSourceRecordInput {
  asserted: Quad;
  filePath: string;
  line?: number;
  endLine?: number;
  /** Pinned-source ref string the triple was loaded from (ADR-0029). */
  gitRef?: string;
  /** Pinned-source resolved commit SHA (ADR-0029). */
  gitSha?: string;
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
  if (input.endLine !== undefined) {
    out.push(
      quad(record, namedNode(input.predicates.endLine), literal(String(input.endLine), XSD_INTEGER)),
    );
  }
  if (input.gitRef !== undefined) {
    out.push(quad(record, namedNode(input.predicates.gitRef), literal(input.gitRef)));
  }
  if (input.gitSha !== undefined) {
    out.push(quad(record, namedNode(input.predicates.gitSha), literal(input.gitSha)));
  }
  return out;
}

function toFileIri(absPath: string): string {
  return absPath.startsWith('/') ? `file://${absPath}` : `file:///${absPath}`;
}
