import { Parser, type Quad, type Store, type Term } from 'n3';
import { canonicalizeStore } from './canonicalize';
import {
  DEFAULT_ANNOTATION_PREDICATE_IRIS,
  type AnnotationPredicateIris,
} from './source-record-builder';

export type RdfDiffFormat = 'human' | 'json' | 'rdf-patch';

export interface RdfDiffResult {
  /** Canonical N-Quads strings present on the right but not the left, sorted lexicographically. */
  added: string[];
  /** Canonical N-Quads strings present on the left but not the right, sorted lexicographically. */
  removed: string[];
}

/**
 * One source-tracking record reconstructed from an annotation triple authored
 * by the `annotate` transform. Identifies where a particular asserted triple
 * was authored.
 */
export interface SourceRecord {
  /** Absolute `file://` IRI of the source file the triple came from. */
  file: string;
  /**
   * 1-based line of the predicate-object pair, when the parser supplied it
   * (omitted for formats whose parsers do not surface line numbers).
   */
  line?: number;
}

export interface DiffSideStore {
  /**
   * The full Store for one side, after `resolveSource`. May contain
   * RDF-star annotation triples (when the source declared `annotate`); when it
   * does not, the side's source-record map will simply be empty.
   */
  store: Store;
  /**
   * Predicate IRIs used by the side's `annotate` transform, threaded from
   * {@link extractAnnotationPredicates}. Defaults to
   * {@link DEFAULT_ANNOTATION_PREDICATE_IRIS} when the source did not override
   * any of them.
   */
  annotationPredicates?: AnnotationPredicateIris;
}

export interface RdfDiffWithSourcesResult extends RdfDiffResult {
  /**
   * Per-side `Map<canonicalNQuadsKey, SourceRecord[]>`. The key is the canonical
   * N-Quads serialization of one asserted quad (matching entries in `added` /
   * `removed` and the equal-on-both-sides quads); the value is the list of
   * records authored under that triple in that side. Empty for sides whose
   * source did not declare `annotate`.
   */
  sourceRecords: {
    left: Map<string, SourceRecord[]>;
    right: Map<string, SourceRecord[]>;
  };
}

export async function diffStores(
  left: DiffSideStore,
  right: DiffSideStore,
): Promise<RdfDiffWithSourcesResult> {
  const [leftCanon, rightCanon] = await Promise.all([
    canonicalizeStore(left.store, {
      annotationPredicates: left.annotationPredicates,
    }),
    canonicalizeStore(right.store, {
      annotationPredicates: right.annotationPredicates,
    }),
  ]);
  const diff = diffCanonicalStatements(
    leftCanon.canonicalStatements,
    rightCanon.canonicalStatements,
  );
  return {
    ...diff,
    sourceRecords: {
      left: extractSourceRecordMap(
        left.store,
        leftCanon.canonicalIdMap,
        left.annotationPredicates ?? DEFAULT_ANNOTATION_PREDICATE_IRIS,
      ),
      right: extractSourceRecordMap(
        right.store,
        rightCanon.canonicalIdMap,
        right.annotationPredicates ?? DEFAULT_ANNOTATION_PREDICATE_IRIS,
      ),
    },
  };
}

function extractSourceRecordMap(
  store: Store,
  canonicalIdMap: Map<string, string>,
  predicates: AnnotationPredicateIris,
): Map<string, SourceRecord[]> {
  const out = new Map<string, SourceRecord[]>();
  const sourcePredicate = predicates.source;
  const filePredicate = predicates.file;
  const linePredicate = predicates.line;

  for (const annotation of store.getQuads(null, null, null, null)) {
    if ((annotation.subject.termType as string) !== 'Quad') continue;
    if (annotation.predicate.value !== sourcePredicate) continue;

    const quotedTriple = annotation.subject as unknown as Quad;
    const recordNode = annotation.object;
    const fileQuads = store.getQuads(
      recordNode,
      { termType: 'NamedNode', value: filePredicate } as Term,
      null,
      null,
    );
    if (fileQuads.length === 0) continue;
    const file = fileQuads[0].object.value;
    const lineQuads = store.getQuads(
      recordNode,
      { termType: 'NamedNode', value: linePredicate } as Term,
      null,
      null,
    );
    const lineRaw = lineQuads[0]?.object.value;
    const record: SourceRecord =
      lineRaw === undefined ? { file } : { file, line: Number(lineRaw) };

    // Bucket the record under every asserted quad whose s/p/o matches the
    // quoted triple, in any graph (the annotation does not record graph).
    const matching = store.getQuads(
      quotedTriple.subject,
      quotedTriple.predicate,
      quotedTriple.object,
      null,
    );
    for (const asserted of matching) {
      if ((asserted.subject.termType as string) === 'Quad') continue;
      const key = canonicalQuadKey(asserted, canonicalIdMap);
      const bucket = out.get(key);
      if (bucket === undefined) out.set(key, [record]);
      else bucket.push(record);
    }
  }
  return out;
}

function canonicalQuadKey(
  q: Quad,
  canonicalIdMap: Map<string, string>,
): string {
  const s = serializeTerm(q.subject, canonicalIdMap);
  const p = serializeTerm(q.predicate, canonicalIdMap);
  const o = serializeTerm(q.object, canonicalIdMap);
  if (q.graph.termType === 'DefaultGraph') return `${s} ${p} ${o} .`;
  const g = serializeTerm(q.graph, canonicalIdMap);
  return `${s} ${p} ${o} ${g} .`;
}

function serializeTerm(
  term: Term,
  canonicalIdMap: Map<string, string>,
): string {
  if (term.termType === 'NamedNode') return `<${term.value}>`;
  if (term.termType === 'BlankNode') {
    const label = canonicalIdMap.get(term.value) ?? term.value;
    return `_:${label}`;
  }
  if (term.termType === 'Literal') {
    const lit = term as Term & { language?: string; datatype?: { value: string } };
    const lex = `"${escapeLiteral(term.value)}"`;
    if (lit.language && lit.language.length > 0) return `${lex}@${lit.language}`;
    if (lit.datatype && lit.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string') {
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

export interface RdfStatementJson {
  s: RdfTermJson;
  p: RdfTermJson;
  o: RdfTermJson;
  g?: RdfTermJson;
}

export interface RdfTermJson {
  termType: string;
  value: string;
  datatype?: string;
  language?: string;
}

export function diffCanonicalStatements(
  left: readonly string[],
  right: readonly string[],
): RdfDiffResult {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const removed = left.filter((s) => !rightSet.has(s)).sort();
  const added = right.filter((s) => !leftSet.has(s)).sort();
  return { added, removed };
}

export function formatRdfDiff(
  diff: RdfDiffResult,
  format: RdfDiffFormat,
): string {
  if (format === 'json') {
    const json = {
      added: diff.added.map(parseStatement),
      removed: diff.removed.map(parseStatement),
    };
    return `${JSON.stringify(json)}\n`;
  }
  if (format === 'rdf-patch') {
    const parts: string[] = [];
    for (const s of diff.removed) parts.push(`D ${s}\n`);
    for (const s of diff.added) parts.push(`A ${s}\n`);
    return parts.join('');
  }
  const parts: string[] = [];
  for (const s of diff.removed) parts.push(`- ${s}\n`);
  for (const s of diff.added) parts.push(`+ ${s}\n`);
  return parts.join('');
}

function parseStatement(line: string): RdfStatementJson {
  const parser = new Parser({ format: 'application/n-quads' });
  const quads = parser.parse(line);
  if (quads.length !== 1) {
    throw new Error(`expected exactly one quad, got ${quads.length}: ${line}`);
  }
  const q = quads[0];
  const out: RdfStatementJson = {
    s: termToJson(q.subject),
    p: termToJson(q.predicate),
    o: termToJson(q.object),
  };
  if (q.graph.termType !== 'DefaultGraph') {
    out.g = termToJson(q.graph);
  }
  return out;
}

function termToJson(term: Term): RdfTermJson {
  const out: RdfTermJson = { termType: term.termType, value: term.value };
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
