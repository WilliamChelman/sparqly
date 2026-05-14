import { DataFactory, Parser, type Store } from 'n3';
import type { DiffTotals, RdfDiffWithSourcesResult, SourceRecord } from './diff';
import { anchorDefinitionSite } from './anchor-definition-site';
import { resolveAnchors } from './resolve-anchors';
import { buildSubjectPath, serializeObject } from './subject-path';
import { compactRdfListsInHunk } from './compact-rdf-lists';
import { compareHunkLines } from './compare-hunk-lines';

const RDF_TYPE_IRI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

export interface HunkedRdfDiff {
  /**
   * Every entity hunk in one list, sorted purely by anchor: lexicographic on
   * the anchor string, with `state` as the only tie-break (`removed` <
   * `changed` < `added`) — the tie-break exists solely to give a deterministic
   * order to a left-only and a right-only orphan hunk that happen to share a
   * canonical bnode label. Orphan hunks (anchors rendered `_:label`) sort
   * naturally by that string; there is no separate region for them.
   */
  hunks: Hunk[];
  totals: DiffTotals;
}

export interface Hunk {
  /**
   * Full IRI of the named entity that owns this hunk, OR — for an orphan
   * bnode-tree hunk — the orphan root's canonical bnode label rendered with
   * the `_:` prefix.
   */
  anchor: string;
  /** Full IRI of `rdf:type` for the anchor, when present on either side. */
  rdfType?: string;
  /**
   * Derived from whether the anchor exists on both sides (`changed`) or only
   * on the left/right (`removed` / `added`). Drives only the hunk's accent
   * colour — not its position in the list, which is purely anchor-sorted.
   */
  state: 'changed' | 'removed' | 'added';
  /**
   * True for synthetic hunks anchored on a bnode tree with no named-entity
   * parent on either side. The renderer surfaces an `(orphan)` marker so the
   * hunk is visible rather than silently absorbed.
   */
  orphan?: boolean;
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
  /**
   * The anchor's **definition site** on a side where it exists but contributed
   * no changed-line source records — one {@link SourceRecord} per file the
   * anchor's triples are annotated from, focused on the earliest annotated line
   * of the anchor in that file. For a `changed` hunk, `anchorSource.left` is
   * filled only when the left contributed zero entries to `sourceRecords.left`
   * *and* the anchor IRI is present in the left store (symmetric for `right`);
   * the other side is then `[]`. Absent for `added` / `removed` (and orphan)
   * hunks, and whenever neither side qualifies — so renderers can show a muted
   * "defined here" snippet without confusing it for a change.
   */
  anchorSource?: { left: SourceRecord[]; right: SourceRecord[] };
}

export interface HunkLine {
  side: '-' | '+';
  /**
   * Identity path used to sort lines within a hunk and to cluster `-`/`+`
   * lines about the same logical subject. For lines whose subject IS the
   * hunk's named anchor this is simply the anchor IRI. For absorbed-bnode
   * lines this is a stable serialization of the path from the anchor to the
   * line's subject (parent predicate + bnode identity per hop), so that two
   * sides that share a `sh:path` value cluster while two sides whose
   * canonical bnode labels happen to differ stay separate.
   */
  subjectPath: string;
  /** Predicate IRI. */
  predicate: string;
  /** Stable string form of the object term (raw N-Quads object text). */
  object: string;
  /** Canonical N-Quads key for this changed quad (matches diff `added`/`removed`). */
  nquad: string;
  /**
   * When the line's subject is an absorbed blank node, the chain of
   * `(parentPredicate, bnodeIdentity)` hops from the hunk anchor down to the
   * subject. Empty/absent when the subject equals the hunk anchor.
   */
  bnodePath?: BnodePathStep[];
  /**
   * Present when this line is a compacted RDF list — the object's bnode head
   * was the start of a complete `rdf:first`/`rdf:rest` chain in the side's
   * store, and the spine triples have been folded into this single line.
   * Each entry is the serialized object form of a list item (matches the
   * shape produced by `serializeObject`).
   */
  listItems?: ReadonlyArray<string>;
}

export interface BnodePathStep {
  /** Predicate from the parent in this hop to the bnode (e.g. `sh:property`). */
  parentPredicate: string;
  /**
   * Predicate whose value identifies this bnode for cross-side pairing
   * (`sh:path` for SHACL property shapes). Omitted when no such identity
   * predicate is present and the canonical bnode label is used as fallback.
   */
  identityPredicate?: string;
  /**
   * Identity value for this bnode within the parent+predicate cluster:
   * the object IRI/literal of `identityPredicate` when present, otherwise
   * the canonical bnode label.
   */
  identityValue: string;
  /** True when `identityValue` is a canonical bnode label (the fallback case). */
  identityIsBlank: boolean;
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
  // `blankNodePrefix: ''` preserves canonical labels like `c14n0` from the
  // diff's N-Quads instead of remapping them to `b<n>_c14n0`. Without this,
  // bnode subjects from the diff would not match the canonical labels in
  // `diff.canonicalIdMap` and bnode walks would fail.
  const parser = new Parser({ format: 'application/n-quads', blankNodePrefix: '' });

  const hunks = new Map<string, Hunk>();
  const seenSourceRecords = new Map<string, Set<string>>(); // hunkKey -> set of "side|file|line"

  // Invert canonical→raw bnode labels per side so we can locate a changed
  // canonical bnode subject in the side's raw Store and walk up its parent
  // chain. Absent when the diff was built via `diffCanonicalStatements`,
  // in which case we keep the MVP behavior (skip bnode-rooted changes).
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
      // Orphan hunks are scoped per side so left and right orphan trees that
      // happen to share a canonical bnode label do not merge into one hunk.
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
      // Orphan hunks have no named anchor in either store — derive state from
      // which sides contributed lines.
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
          hunk.sourceRecords.left.length === 0 && onLeft
            ? anchorDefinitionSite(left.store, hunk.anchor)
            : [];
        const rightDef =
          hunk.sourceRecords.right.length === 0 && onRight
            ? anchorDefinitionSite(right.store, hunk.anchor)
            : [];
        if (leftDef.length > 0 || rightDef.length > 0) {
          hunk.anchorSource = { left: leftDef, right: rightDef };
        }
      }
    }
    allHunks.push(hunk);
  }

  // One comparator: lexicographic on the anchor, `state` as the only
  // tie-break (`removed` < `changed` < `added`) — disambiguates a left-only
  // and a right-only orphan hunk sharing a canonical bnode label.
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
  // `getQuads(s, null, null, null)` is O(1) on the s-indexed map; we only need
  // existence, not enumeration.
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
