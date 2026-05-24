import { Parser, type Quad, type Store, type Term } from 'n3';
import {
  canonicalizeStore,
  computeBnodeShapeMap,
  shapeNormalizeCanonicalNQuad,
} from '../canonical';
import { formatHumanSourceComment } from './format-human-source-comment';
import {
  formatGroupedRdfDiff,
  type FormatGroupedRdfDiffOptions,
} from './grouped-diff-formatter';
import type { HunkedRdfDiff } from './group-rdf-diff-by-entity';
import { renderTurtleDiffBlocks } from './turtle-diff-formatter';
import {
  triplePatternKey,
  type AnnotationPredicateIris,
  type SourceRecord,
  type SourceRecordSidecar,
} from '../sources';

export type RdfDiffFormat =
  | 'human'
  | 'json'
  | 'rdf-patch'
  | 'turtle'
  | 'grouped';

export interface RdfDiffResult {
  /** Canonical N-Quads strings present on the right but not the left, sorted lexicographically. */
  added: string[];
  /** Canonical N-Quads strings present on the left but not the right, sorted lexicographically. */
  removed: string[];
  /** Per-side count of post-strip asserted quads. */
  totals: DiffTotals;
}

export interface DiffTotals {
  left: number;
  right: number;
}

export interface DiffSideStore {
  store: Store;
  /** Annotation predicate IRIs to strip before canonicalization. */
  annotationPredicates?: AnnotationPredicateIris;
  /** Loader-attached source-record sidecar, re-keyed onto canonical N-Quads. */
  sourceRecords?: SourceRecordSidecar;
}

export interface RdfDiffWithSourcesResult extends RdfDiffResult {
  /** Per-side records keyed by canonical N-Quad. Empty when no `annotate` transform. */
  sourceRecords: {
    left: Map<string, SourceRecord[]>;
    right: Map<string, SourceRecord[]>;
  };
  /** Per-side RDFC-1.0 label map; absent from {@link diffCanonicalStatements} results. */
  canonicalIdMap?: {
    left: Map<string, string>;
    right: Map<string, string>;
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
  const diff = diffWithPairedBnodes(
    leftCanon.canonicalStatements,
    leftCanon.canonicalText,
    rightCanon.canonicalStatements,
    rightCanon.canonicalText,
  );
  return {
    ...diff,
    sourceRecords: {
      left: buildSideRecordMap(left, leftCanon.canonicalIdMap),
      right: buildSideRecordMap(right, rightCanon.canonicalIdMap),
    },
    canonicalIdMap: {
      left: leftCanon.canonicalIdMap,
      right: rightCanon.canonicalIdMap,
    },
  };
}

function diffWithPairedBnodes(
  leftStatements: readonly string[],
  leftCanonicalText: string,
  rightStatements: readonly string[],
  rightCanonicalText: string,
): RdfDiffResult {
  const leftHasBnode = leftStatements.some((s) => s.includes('_:'));
  const rightHasBnode = rightStatements.some((s) => s.includes('_:'));
  if (!leftHasBnode && !rightHasBnode) {
    return diffCanonicalStatements(leftStatements, rightStatements);
  }

  const { leftPairMap, rightPairMap } = computeBnodePairing(
    leftCanonicalText,
    rightCanonicalText,
  );

  const leftBucket = bucketByRewrite(leftStatements, leftPairMap);
  const rightBucket = bucketByRewrite(rightStatements, rightPairMap);

  const removed: string[] = [];
  const added: string[] = [];
  const keys = new Set<string>();
  for (const k of leftBucket.keys()) keys.add(k);
  for (const k of rightBucket.keys()) keys.add(k);
  for (const key of keys) {
    const lArr = leftBucket.get(key) ?? [];
    const rArr = rightBucket.get(key) ?? [];
    const paired = Math.min(lArr.length, rArr.length);
    if (lArr.length > paired) {
      const sorted = lArr.slice().sort();
      for (let i = paired; i < sorted.length; i++) removed.push(sorted[i]);
    }
    if (rArr.length > paired) {
      const sorted = rArr.slice().sort();
      for (let i = paired; i < sorted.length; i++) added.push(sorted[i]);
    }
  }
  removed.sort();
  added.sort();
  return {
    added,
    removed,
    totals: { left: leftStatements.length, right: rightStatements.length },
  };
}

/** Pair shape-equal bnodes across sides (up to per-side multiplicity) under shared tokens. */
function computeBnodePairing(
  leftCanonicalText: string,
  rightCanonicalText: string,
): { leftPairMap: Map<string, string>; rightPairMap: Map<string, string> } {
  const leftShape = computeBnodeShapeMap(leftCanonicalText);
  const rightShape = computeBnodeShapeMap(rightCanonicalText);
  const leftByShape = groupBnodeLabelsByShape(leftShape);
  const rightByShape = groupBnodeLabelsByShape(rightShape);
  const leftPairMap = new Map<string, string>();
  const rightPairMap = new Map<string, string>();
  const allShapes = new Set<string>();
  for (const k of leftByShape.keys()) allShapes.add(k);
  for (const k of rightByShape.keys()) allShapes.add(k);
  for (const shape of allShapes) {
    const l = leftByShape.get(shape) ?? [];
    const r = rightByShape.get(shape) ?? [];
    const n = Math.min(l.length, r.length);
    for (let i = 0; i < n; i++) {
      const token = `paired-${shape}-${i}`;
      leftPairMap.set(l[i], token);
      rightPairMap.set(r[i], token);
    }
  }
  return { leftPairMap, rightPairMap };
}

function groupBnodeLabelsByShape(
  shapeMap: Map<string, string>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [label, shape] of shapeMap) {
    const arr = out.get(shape);
    if (arr === undefined) out.set(shape, [label]);
    else arr.push(label);
  }
  for (const arr of out.values()) arr.sort();
  return out;
}

function bucketByRewrite(
  statements: readonly string[],
  pairMap: Map<string, string>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of statements) {
    const key =
      pairMap.size > 0 && s.includes('_:')
        ? shapeNormalizeCanonicalNQuad(s, pairMap)
        : s;
    const arr = out.get(key);
    if (arr === undefined) out.set(key, [s]);
    else arr.push(s);
  }
  return out;
}

function buildSideRecordMap(
  side: DiffSideStore,
  canonicalIdMap: Map<string, string>,
): Map<string, SourceRecord[]> {
  if (side.sourceRecords === undefined) return new Map();
  return sidecarToCanonicalRecordMap(
    side.store,
    side.sourceRecords,
    canonicalIdMap,
  );
}

function sidecarToCanonicalRecordMap(
  store: Store,
  sidecar: SourceRecordSidecar,
  canonicalIdMap: Map<string, string>,
): Map<string, SourceRecord[]> {
  const out = new Map<string, SourceRecord[]>();
  for (const asserted of store.getQuads(null, null, null, null)) {
    if ((asserted.subject.termType as string) === 'Quad') continue;
    const patternKey = triplePatternKey(
      asserted.subject,
      asserted.predicate,
      asserted.object,
    );
    const records = sidecar.get(patternKey);
    if (records === undefined) continue;
    const canonKey = canonicalQuadKey(asserted, canonicalIdMap);
    let bucket = out.get(canonKey);
    if (bucket === undefined) {
      bucket = [];
      out.set(canonKey, bucket);
    }
    for (const r of records) bucket.push(r);
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
  /** Side-appropriate records (right on `added`, left on `removed`); omitted when empty. */
  sourceRecords?: SourceRecord[];
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
  return {
    added,
    removed,
    totals: { left: leftSet.size, right: rightSet.size },
  };
}

export interface FormatRdfDiffOptions {
  /** Per-side records for the `human` format's trailing `# path:line` comments. */
  sourceRecords?: {
    left: Map<string, SourceRecord[]>;
    right: Map<string, SourceRecord[]>;
  };
  /** Required when `sourceRecords` is set; resolves relative paths for trailing comments. */
  cwd?: string;
  /** CURIE prefixes for the `turtle` format. */
  prefixes?: Record<string, string>;
  /** Required for the `grouped` format; build via `groupRdfDiffByEntity`. */
  hunked?: HunkedRdfDiff;
}

export function formatRdfDiff(
  diff: RdfDiffResult,
  format: RdfDiffFormat,
  options: FormatRdfDiffOptions = {},
): string {
  if (format === 'grouped') {
    if (options.hunked === undefined) {
      throw new Error(
        "formatRdfDiff: format 'grouped' requires options.hunked — call groupRdfDiffByEntity first to build it from both sides' Stores",
      );
    }
    const groupedOpts: FormatGroupedRdfDiffOptions = {
      prefixes: options.prefixes ?? {},
    };
    return formatGroupedRdfDiff(options.hunked, groupedOpts);
  }
  if (format === 'json') {
    const leftRecordsJson = options.sourceRecords?.left;
    const rightRecordsJson = options.sourceRecords?.right;
    const json = {
      added: diff.added.map((s) =>
        attachRecords(parseStatement(s), rightRecordsJson?.get(s)),
      ),
      removed: diff.removed.map((s) =>
        attachRecords(parseStatement(s), leftRecordsJson?.get(s)),
      ),
      totals: { left: diff.totals.left, right: diff.totals.right },
    };
    return `${JSON.stringify(json)}\n`;
  }
  if (format === 'turtle') {
    return formatDiffSummaryComment(diff) + renderTurtleDiffBlocks(diff, options);
  }
  const removedMarker = format === 'rdf-patch' ? 'D' : '-';
  const addedMarker = format === 'rdf-patch' ? 'A' : '+';
  const parts: string[] = [formatDiffSummaryComment(diff)];
  const cwd = options.cwd;
  const leftRecords = options.sourceRecords?.left;
  const rightRecords = options.sourceRecords?.right;
  for (const s of diff.removed) {
    const tail =
      cwd !== undefined
        ? formatHumanSourceComment(leftRecords?.get(s) ?? [], cwd)
        : '';
    parts.push(`${removedMarker} ${s}${tail}\n`);
  }
  for (const s of diff.added) {
    const tail =
      cwd !== undefined
        ? formatHumanSourceComment(rightRecords?.get(s) ?? [], cwd)
        : '';
    parts.push(`${addedMarker} ${s}${tail}\n`);
  }
  return parts.join('');
}

/** Canonical `left=L right=R +x -y` summary line shared across all surfaces. */
export function formatDiffSummaryLine(
  totals: DiffTotals,
  added: number,
  removed: number,
): string {
  return `left=${totals.left} right=${totals.right} +${added} -${removed}`;
}

function formatDiffSummaryComment(diff: RdfDiffResult): string {
  return `# ${formatDiffSummaryLine(diff.totals, diff.added.length, diff.removed.length)}\n`;
}

function attachRecords(
  statement: RdfStatementJson,
  records: SourceRecord[] | undefined,
): RdfStatementJson {
  if (records === undefined || records.length === 0) return statement;
  return { ...statement, sourceRecords: records };
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
