import { Parser, type Quad, type Store, type Term } from 'n3';
import { canonicalizeStore } from './canonicalize';
import { formatHumanSourceComment } from './format-human-source-comment';
import { shortenNQuadLine } from './formatter';
import {
  formatGroupedRdfDiff,
  type FormatGroupedRdfDiffOptions,
} from './grouped-diff-formatter';
import type { HunkedRdfDiff } from './group-rdf-diff-by-entity';
import { displaySourcePath } from './source-path-display';
import {
  DEFAULT_ANNOTATION_PREDICATE_IRIS,
  type AnnotationPredicateIris,
} from './source-record-builder';

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
  /**
   * Per-side count of post-strip asserted quads — i.e. the size of each
   * side's canonical N-Quads set, with RDF-star annotations excluded. By
   * construction `left - common = removed.length` and
   * `right - common = added.length`.
   */
  totals: DiffTotals;
}

export interface DiffTotals {
  left: number;
  right: number;
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
  /**
   * 1-based last source line of the predicate-object pair when the object
   * spans multiple lines (triple-quoted literal, multi-line `( … )` list,
   * multi-line `[ … ]` blank node). Absent for single-line records.
   */
  endLine?: number;
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
  /**
   * Per-side `Map<storeBlankNodeLabel, canonicalBlankNodeLabel>` issued by
   * RDFC-1.0. Populated by {@link diffStores}; absent on results built via
   * {@link diffCanonicalStatements} (which never sees the underlying Stores).
   * Consumers that need to walk the parent chain of a canonical bnode in the
   * raw Store invert this map.
   */
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
    canonicalIdMap: {
      left: leftCanon.canonicalIdMap,
      right: rightCanon.canonicalIdMap,
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
  const endLinePredicate = predicates.endLine;

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
    const endLineQuads = store.getQuads(
      recordNode,
      { termType: 'NamedNode', value: endLinePredicate } as Term,
      null,
      null,
    );
    const endLineRaw = endLineQuads[0]?.object.value;
    const record: SourceRecord = { file };
    if (lineRaw !== undefined) record.line = Number(lineRaw);
    if (endLineRaw !== undefined) record.endLine = Number(endLineRaw);

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
  /**
   * Per-entry `SourceRecord[]` populated from the canonical side (right-side
   * records on `added`, left-side records on `removed`) when
   * {@link FormatRdfDiffOptions.sourceRecords} is supplied to the `json`
   * format. Omitted when no records are present, so existing JSON consumers
   * remain byte-identical for unannotated sources.
   */
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
  /**
   * Per-side `Map<canonicalNQuadsKey, SourceRecord[]>` returned by
   * {@link diffStores}. When supplied for the `human` format, each `+` /
   * `-` hunk is augmented with a trailing inline `# path:line` comment
   * built from the side that authored the hunk (right for `+`, left for
   * `-`). Other formats currently ignore this option.
   */
  sourceRecords?: {
    left: Map<string, SourceRecord[]>;
    right: Map<string, SourceRecord[]>;
  };
  /**
   * Working directory for trailing-comment path display. Required when
   * `sourceRecords` is supplied.
   */
  cwd?: string;
  /**
   * Prefixes used by the `turtle` format to CURIE-shorten each flat statement
   * and to emit `@prefix` declarations at the top of every
   * `# --- removed/added ---` block. Ignored by other formats.
   */
  prefixes?: Record<string, string>;
  /**
   * Pre-computed `HunkedRdfDiff` used by the `grouped` format. Required when
   * `format === 'grouped'`; ignored by other formats. Built by callers via
   * {@link import('./group-rdf-diff-by-entity').groupRdfDiffByEntity} so the
   * grouping algorithm sees both Stores while {@link formatRdfDiff} stays
   * Store-agnostic.
   */
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

/**
 * Canonical one-line `# left=L right=R +x -y` summary, shared between the
 * stderr summary, every text-format body, and the html `<p class="summary">`.
 */
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

function renderTurtleDiffBlocks(
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
