import { DataFactory, Parser, type Store } from 'n3';
import type { DiffTotals, RdfDiffWithSourcesResult } from './diff';
import type { SourceRecord, SourceRecordSidecar } from '../sources';
import { anchorDefinitionSite } from './anchor-definition-site';
import { resolveAnchors } from './resolve-anchors';
import { buildSubjectPath, serializeObject } from './subject-path';
import { compactRdfListsInHunk } from './compact-rdf-lists';
import { compareHunkLines } from './compare-hunk-lines';

const RDF_TYPE_IRI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

export interface HunkedRdfDiff {
  /** Sorted lexicographically by anchor; `state` is the tie-break (`removed` < `changed` < `added`). */
  hunks: Hunk[];
  totals: DiffTotals;
}

export interface Hunk {
  /** Entity IRI, or orphan bnode-tree root rendered as `_:label`. */
  anchor: string;
  /** Full IRI of `rdf:type` for the anchor, when present on either side. */
  rdfType?: string;
  /** Anchor presence: both sides (`changed`), left-only (`removed`), or right-only (`added`). */
  state: 'changed' | 'removed' | 'added';
  /** Synthetic hunk anchored on a bnode tree with no named-entity parent. */
  orphan?: boolean;
  /** Count of `-` lines in this hunk. */
  removed: number;
  /** Count of `+` lines in this hunk. */
  added: number;
  /** Ordered diff lines for this hunk. */
  lines: HunkLine[];
  /** Per-side `(file, line)`-deduplicated records from every changed line. */
  sourceRecords: { left: SourceRecord[]; right: SourceRecord[] };
  /** Anchor definition site for a `changed` hunk's side that contributed no changed-line records. */
  anchorSource?: { left: SourceRecord[]; right: SourceRecord[] };
}

export interface HunkLine {
  side: '-' | '+';
  /** Sort/cluster key: anchor IRI, or for absorbed bnodes the path from anchor down. */
  subjectPath: string;
  /** Predicate IRI. */
  predicate: string;
  /** Stable string form of the object term (raw N-Quads object text). */
  object: string;
  /** Canonical N-Quads key for this changed quad (matches diff `added`/`removed`). */
  nquad: string;
  /** Hops from anchor to subject for absorbed-bnode lines; absent when subject is the anchor. */
  bnodePath?: BnodePathStep[];
  /** Folded `rdf:first`/`rdf:rest` list items when the object's bnode is a complete list head. */
  listItems?: ReadonlyArray<string>;
}

export interface BnodePathStep {
  /** Predicate from the parent in this hop to the bnode (e.g. `sh:property`). */
  parentPredicate: string;
  /** Predicate that identifies this bnode for cross-side pairing (e.g. `sh:path`). */
  identityPredicate?: string;
  /** Object of `identityPredicate`, or the canonical bnode label when absent. */
  identityValue: string;
  /** True when `identityValue` is a canonical bnode label (the fallback case). */
  identityIsBlank: boolean;
}

export interface GroupRdfDiffByEntityInput {
  diff: RdfDiffWithSourcesResult;
  left: { store: Store; sourceRecords?: SourceRecordSidecar };
  right: { store: Store; sourceRecords?: SourceRecordSidecar };
}

export function groupRdfDiffByEntity(
  input: GroupRdfDiffByEntityInput,
): HunkedRdfDiff {
  const { diff, left, right } = input;
  // `blankNodePrefix: ''` preserves canonical labels so they match `diff.canonicalIdMap`.
  const parser = new Parser({ format: 'application/n-quads', blankNodePrefix: '' });

  const hunks = new Map<string, Hunk>();
  const seenSourceRecords = new Map<string, Set<string>>(); // hunkKey -> set of "side|file|line"

  // Invert canonical→raw so we can locate a canonical bnode in the side's raw Store.
  const inverseLeft = invertCanonicalIdMap(diff.canonicalIdMap?.left);
  const inverseRight = invertCanonicalIdMap(diff.canonicalIdMap?.right);

  function ensureHunk(key: string, anchor: string, orphan: boolean): Hunk {
    let h = hunks.get(key);
    if (h === undefined) {
      h = {
        anchor,
        state: 'changed',
        removed: 0,
        added: 0,
        lines: [],
        sourceRecords: { left: [], right: [] },
      };
      if (orphan) h.orphan = true;
      hunks.set(key, h);
      seenSourceRecords.set(key, new Set());
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
    const sideStore = side === '-' ? left.store : right.store;
    const sideInverse = side === '-' ? inverseLeft : inverseRight;
    const sideForward = side === '-' ? diff.canonicalIdMap?.left : diff.canonicalIdMap?.right;
    const resolved = resolveAnchors(q, sideStore, sideInverse, sideForward);
    if (resolved.length === 0) return;
    for (const { anchor, bnodePath, orphan } of resolved) {
      // Orphan hunks are scoped per side so shared canonical labels don't merge.
      const hunkKey = orphan ? `orphan|${side}|${anchor}` : anchor;
      const hunk = ensureHunk(hunkKey, anchor, orphan);
      hunk.lines.push({
        side,
        subjectPath: buildSubjectPath(anchor, bnodePath, q.subject),
        predicate: q.predicate.value,
        object: serializeObject(q.object),
        nquad,
        ...(bnodePath.length > 0 ? { bnodePath } : {}),
      });
      if (side === '-') hunk.removed += 1;
      else hunk.added += 1;
      if (sourceRecords !== undefined && sourceRecords.length > 0) {
        const seen = seenSourceRecords.get(hunkKey) as Set<string>;
        const bucket = side === '-' ? hunk.sourceRecords.left : hunk.sourceRecords.right;
        for (const rec of sourceRecords) {
          const key = `${side}|${rec.file}|${rec.line ?? ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          bucket.push(rec);
        }
      }
    }
  }

  for (const nquad of diff.removed) {
    addLine(nquad, '-', diff.sourceRecords.left.get(nquad));
  }
  for (const nquad of diff.added) {
    addLine(nquad, '+', diff.sourceRecords.right.get(nquad));
  }

  const allHunks: Hunk[] = [];

  for (const hunk of hunks.values()) {
    compactRdfListsInHunk(
      hunk,
      { store: left.store, forward: diff.canonicalIdMap?.left, inverse: inverseLeft },
      { store: right.store, forward: diff.canonicalIdMap?.right, inverse: inverseRight },
    );
    hunk.lines.sort(compareHunkLines);
    if (hunk.orphan === true) {
      // No named anchor — derive state from which sides contributed lines.
      hunk.state =
        hunk.removed > 0 && hunk.added === 0
          ? 'removed'
          : hunk.added > 0 && hunk.removed === 0
            ? 'added'
            : 'changed';
    } else {
      const rdfType = lookupRdfType(hunk.anchor, right.store, left.store);
      if (rdfType !== undefined) hunk.rdfType = rdfType;
      const onLeft = anchorPresentInStore(hunk.anchor, left.store);
      const onRight = anchorPresentInStore(hunk.anchor, right.store);
      hunk.state =
        onLeft && !onRight ? 'removed' : !onLeft && onRight ? 'added' : 'changed';
      if (hunk.state === 'changed') {
        const leftDef =
          hunk.sourceRecords.left.length === 0 && onLeft && left.sourceRecords !== undefined
            ? anchorDefinitionSite(left.store, hunk.anchor, left.sourceRecords)
            : [];
        const rightDef =
          hunk.sourceRecords.right.length === 0 && onRight && right.sourceRecords !== undefined
            ? anchorDefinitionSite(right.store, hunk.anchor, right.sourceRecords)
            : [];
        if (leftDef.length > 0 || rightDef.length > 0) {
          hunk.anchorSource = { left: leftDef, right: rightDef };
        }
      }
    }
    allHunks.push(hunk);
  }

  const stateRank: Record<Hunk['state'], number> = {
    removed: 0,
    changed: 1,
    added: 2,
  };
  allHunks.sort((a, b) =>
    a.anchor !== b.anchor
      ? a.anchor < b.anchor
        ? -1
        : 1
      : stateRank[a.state] - stateRank[b.state],
  );

  return { hunks: allHunks, totals: diff.totals };
}

function anchorPresentInStore(anchorIri: string, store: Store): boolean {
  const subject = DataFactory.namedNode(anchorIri);
  const quads = store.getQuads(subject, null, null, null);
  return quads.length > 0;
}

function invertCanonicalIdMap(
  forward: Map<string, string> | undefined,
): Map<string, string> | undefined {
  if (forward === undefined) return undefined;
  const inv = new Map<string, string>();
  for (const [raw, canon] of forward.entries()) inv.set(canon, raw);
  return inv;
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
