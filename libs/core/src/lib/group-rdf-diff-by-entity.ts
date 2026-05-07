import { DataFactory, Parser, type Quad, type Store, type Term } from 'n3';
import type { DiffTotals, RdfDiffWithSourcesResult, SourceRecord } from './diff';

const RDF_TYPE_IRI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

export interface HunkedRdfDiff {
  hunks: Hunk[];
  totals: DiffTotals;
}

export interface Hunk {
  /** Full IRI of the named entity that owns this hunk. */
  anchor: string;
  /** Full IRI of `rdf:type` for the anchor, when present on either side. */
  rdfType?: string;
  /** Count of `-` lines in this hunk. */
  removed: number;
  /** Count of `+` lines in this hunk. */
  added: number;
  /** Ordered diff lines for this hunk. */
  lines: HunkLine[];
  /**
   * Per-side `(file, line)`-deduplicated source records gathered from every
   * changed line in this hunk.
   */
  sourceRecords: { left: SourceRecord[]; right: SourceRecord[] };
}

export interface HunkLine {
  side: '-' | '+';
  /** Identity path used for sorting; the subject IRI in the MVP slice. */
  subjectPath: string;
  /** Predicate IRI. */
  predicate: string;
  /** Stable string form of the object term (raw N-Quads object text). */
  object: string;
  /** Canonical N-Quads key for this changed quad (matches diff `added`/`removed`). */
  nquad: string;
}

export interface GroupRdfDiffByEntityInput {
  diff: RdfDiffWithSourcesResult;
  left: { store: Store };
  right: { store: Store };
}

export function groupRdfDiffByEntity(
  input: GroupRdfDiffByEntityInput,
): HunkedRdfDiff {
  const { diff, left, right } = input;
  const parser = new Parser({ format: 'application/n-quads' });

  const hunks = new Map<string, Hunk>();
  const seenSourceRecords = new Map<string, Set<string>>(); // anchor -> set of "side|file|line"

  function ensureHunk(anchor: string): Hunk {
    let h = hunks.get(anchor);
    if (h === undefined) {
      h = {
        anchor,
        removed: 0,
        added: 0,
        lines: [],
        sourceRecords: { left: [], right: [] },
      };
      hunks.set(anchor, h);
      seenSourceRecords.set(anchor, new Set());
    }
    return h;
  }

  function addLine(
    nquad: string,
    side: '-' | '+',
    sourceRecords: SourceRecord[] | undefined,
  ): void {
    const quads = parser.parse(nquad);
    if (quads.length !== 1) return;
    const q = quads[0];
    const anchor = anchorForQuad(q);
    if (anchor === undefined) return;
    const hunk = ensureHunk(anchor);
    hunk.lines.push({
      side,
      subjectPath: termToPath(q.subject),
      predicate: q.predicate.value,
      object: serializeObject(q.object),
      nquad,
    });
    if (side === '-') hunk.removed += 1;
    else hunk.added += 1;
    if (sourceRecords !== undefined && sourceRecords.length > 0) {
      const seen = seenSourceRecords.get(anchor) as Set<string>;
      const bucket = side === '-' ? hunk.sourceRecords.left : hunk.sourceRecords.right;
      for (const rec of sourceRecords) {
        const key = `${side}|${rec.file}|${rec.line ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        bucket.push(rec);
      }
    }
  }

  for (const nquad of diff.removed) {
    addLine(nquad, '-', diff.sourceRecords.left.get(nquad));
  }
  for (const nquad of diff.added) {
    addLine(nquad, '+', diff.sourceRecords.right.get(nquad));
  }

  for (const hunk of hunks.values()) {
    hunk.lines.sort(compareHunkLines);
    const rdfType = lookupRdfType(hunk.anchor, right.store, left.store);
    if (rdfType !== undefined) hunk.rdfType = rdfType;
  }

  const sortedHunks = [...hunks.values()].sort((a, b) =>
    a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0,
  );

  return { hunks: sortedHunks, totals: diff.totals };
}

function lookupRdfType(
  anchorIri: string,
  preferred: Store,
  fallback: Store,
): string | undefined {
  const subject = DataFactory.namedNode(anchorIri);
  const predicate = DataFactory.namedNode(RDF_TYPE_IRI);
  for (const store of [preferred, fallback]) {
    const quads = store.getQuads(subject, predicate, null, null);
    for (const q of quads) {
      if (q.object.termType === 'NamedNode') return q.object.value;
    }
  }
  return undefined;
}

function anchorForQuad(q: Quad): string | undefined {
  if (q.subject.termType === 'NamedNode') return q.subject.value;
  // MVP: bnode-rooted changes are not yet bucketed under a named ancestor.
  // Sibling slices will introduce store-walk anchoring; for now skip.
  return undefined;
}

function termToPath(term: Term): string {
  if (term.termType === 'NamedNode') return term.value;
  if (term.termType === 'BlankNode') return `_:${term.value}`;
  return term.value;
}

function serializeObject(term: Term): string {
  if (term.termType === 'NamedNode') return `<${term.value}>`;
  if (term.termType === 'BlankNode') return `_:${term.value}`;
  if (term.termType === 'Literal') {
    const lit = term as Term & {
      language?: string;
      datatype?: { value: string };
    };
    const lex = `"${escapeLiteral(term.value)}"`;
    if (lit.language && lit.language.length > 0) return `${lex}@${lit.language}`;
    if (
      lit.datatype &&
      lit.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string'
    ) {
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

function compareHunkLines(a: HunkLine, b: HunkLine): number {
  if (a.subjectPath !== b.subjectPath) {
    return a.subjectPath < b.subjectPath ? -1 : 1;
  }
  if (a.predicate !== b.predicate) {
    return a.predicate < b.predicate ? -1 : 1;
  }
  // Same (subject, predicate) cluster: `-` precedes `+`.
  if (a.side !== b.side) return a.side === '-' ? -1 : 1;
  // Stable tie-break by object form so output is deterministic.
  if (a.object !== b.object) return a.object < b.object ? -1 : 1;
  return 0;
}
