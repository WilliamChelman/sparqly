import { DataFactory, Parser, type Quad, type Store, type Term } from 'n3';
import type { DiffTotals, RdfDiffWithSourcesResult, SourceRecord } from './diff';

const RDF_TYPE_IRI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDF_FIRST_IRI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
const RDF_REST_IRI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest';
const RDF_NIL_IRI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil';
const SH_PATH_IRI = 'http://www.w3.org/ns/shacl#path';

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

interface ResolvedAnchor {
  anchor: string;
  /** Empty when subject is the named anchor itself. */
  bnodePath: BnodePathStep[];
  /** True when this anchor was synthesized from an orphan bnode tree. */
  orphan: boolean;
}

function resolveAnchors(
  q: Quad,
  store: Store,
  inverseCanonicalIdMap: Map<string, string> | undefined,
  forwardCanonicalIdMap: Map<string, string> | undefined,
): ResolvedAnchor[] {
  if (q.subject.termType === 'NamedNode') {
    return [{ anchor: q.subject.value, bnodePath: [], orphan: false }];
  }
  if (q.subject.termType !== 'BlankNode') return [];
  if (inverseCanonicalIdMap === undefined) return [];
  // The diff exposes canonical bnode labels (e.g. `c14n0`); walk the parent
  // chain in the side's raw Store, where bnodes carry their original parser
  // labels. Map canonical → raw via the inverted canonicalIdMap.
  const canonicalLabel = q.subject.value;
  const rawLabel = inverseCanonicalIdMap.get(canonicalLabel);
  if (rawLabel === undefined) return [];
  const named = findAllNamedAncestors(rawLabel, store);
  if (named.length > 0) return named;
  // No named ancestor — synthesize an orphan anchor on the bnode tree's root
  // canonical label so the changes surface rather than getting silently
  // dropped.
  const orphan = synthesizeOrphanAnchor(rawLabel, store, forwardCanonicalIdMap);
  return orphan === undefined ? [] : [orphan];
}

function findAllNamedAncestors(
  startRawLabel: string,
  store: Store,
): ResolvedAnchor[] {
  // BFS upward through the bnode parent chain, collecting every distinct
  // named ancestor reachable from the start bnode. For the multi-parent case
  // (a bnode reachable from two or more named parents) we emit one anchor per
  // named ancestor; the caller duplicates the line under each.
  const results = new Map<string, ResolvedAnchor>();
  // Each frame: (currentRawLabel, reversedHops-so-far, set-of-visited-on-this-path).
  // We track visited per-path so independent paths upward can share bnodes
  // without one short-circuiting the other.
  const queue: Array<{
    current: string;
    reversedHops: BnodePathStep[];
    visited: Set<string>;
  }> = [{ current: startRawLabel, reversedHops: [], visited: new Set() }];
  while (queue.length > 0) {
    const frame = queue.shift() as (typeof queue)[number];
    const { current, reversedHops, visited } = frame;
    if (visited.has(current)) continue;
    const nextVisited = new Set(visited);
    nextVisited.add(current);
    const incoming = store.getQuads(
      null,
      null,
      DataFactory.blankNode(current),
      null,
    );
    if (incoming.length === 0) continue;
    const step = bnodeStepFor(current, store);
    // Sort incoming for determinism: named parents lex by IRI, then bnode
    // parents lex by raw label.
    const namedParents = incoming
      .filter((qq) => qq.subject.termType === 'NamedNode')
      .sort((a, b) =>
        a.subject.value < b.subject.value
          ? -1
          : a.subject.value > b.subject.value
            ? 1
            : a.predicate.value < b.predicate.value
              ? -1
              : a.predicate.value > b.predicate.value
                ? 1
                : 0,
      );
    for (const np of namedParents) {
      const hops = [
        ...reversedHops,
        { ...step, parentPredicate: np.predicate.value },
      ];
      const path: BnodePathStep[] = [];
      for (let i = hops.length - 1; i >= 0; i--) path.push(hops[i]);
      const anchor = np.subject.value;
      // Dedup: if multiple paths lead to the same named ancestor, keep the
      // first (deterministic by BFS order + sort).
      if (!results.has(anchor)) {
        results.set(anchor, { anchor, bnodePath: path, orphan: false });
      }
    }
    const bnodeParents = incoming
      .filter((qq) => qq.subject.termType === 'BlankNode')
      .sort((a, b) =>
        a.subject.value < b.subject.value ? -1 : a.subject.value > b.subject.value ? 1 : 0,
      );
    for (const bp of bnodeParents) {
      queue.push({
        current: bp.subject.value,
        reversedHops: [
          ...reversedHops,
          { ...step, parentPredicate: bp.predicate.value },
        ],
        visited: nextVisited,
      });
    }
  }
  // Sort by anchor IRI for deterministic emission order.
  return Array.from(results.values()).sort((a, b) =>
    a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0,
  );
}

function synthesizeOrphanAnchor(
  startRawLabel: string,
  store: Store,
  forwardCanonicalIdMap: Map<string, string> | undefined,
): ResolvedAnchor | undefined {
  // Walk up through bnode parents to find the orphan tree's root. For cycles
  // or shared-ancestor topologies we pick the lex-smallest reachable root
  // canonical label, so the anchor is stable regardless of which leaf bnode
  // started the walk.
  const visited = new Set<string>();
  const stack: string[] = [startRawLabel];
  const roots = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (visited.has(current)) continue;
    visited.add(current);
    const incoming = store.getQuads(
      null,
      null,
      DataFactory.blankNode(current),
      null,
    );
    if (incoming.length === 0) {
      roots.add(current);
      continue;
    }
    const bnodeParents = incoming.filter(
      (qq) => qq.subject.termType === 'BlankNode',
    );
    if (bnodeParents.length === 0) {
      // Only non-bnode parents remain after filtering, but findAllNamedAncestors
      // already failed — treat the current node as a root for cycle robustness.
      roots.add(current);
      continue;
    }
    let advanced = false;
    for (const bp of bnodeParents) {
      if (!visited.has(bp.subject.value)) {
        stack.push(bp.subject.value);
        advanced = true;
      }
    }
    if (!advanced) roots.add(current);
  }
  if (roots.size === 0) return undefined;
  // Translate raw labels to canonical labels so the anchor is stable across
  // the side's parser-assigned blank-node names. Pick the lex-smallest
  // canonical label.
  const canonicals: string[] = [];
  for (const raw of roots) {
    const canonical = forwardCanonicalIdMap?.get(raw) ?? raw;
    canonicals.push(canonical);
  }
  canonicals.sort();
  return { anchor: `_:${canonicals[0]}`, bnodePath: [], orphan: true };
}

function bnodeStepFor(
  rawLabel: string,
  store: Store,
): { identityPredicate?: string; identityValue: string; identityIsBlank: boolean } {
  const shPathQuads = store.getQuads(
    DataFactory.blankNode(rawLabel),
    DataFactory.namedNode(SH_PATH_IRI),
    null,
    null,
  );
  if (shPathQuads.length > 0) {
    const v = shPathQuads[0].object;
    const identityValue =
      v.termType === 'NamedNode' || v.termType === 'BlankNode'
        ? v.value
        : serializeObject(v);
    return {
      identityPredicate: SH_PATH_IRI,
      identityValue,
      identityIsBlank: false,
    };
  }
  // Fallback: canonical bnode label. We do not have it here (only the raw
  // label), so callers must translate at sort/serialize time. Using the raw
  // label is stable within a side; cross-side pairing is intentionally not
  // performed when sh:path is absent.
  return {
    identityValue: `_:${rawLabel}`,
    identityIsBlank: true,
  };
}

function buildSubjectPath(
  anchor: string,
  bnodePath: BnodePathStep[],
  subject: Term,
): string {
  if (bnodePath.length === 0) {
    if (subject.termType === 'NamedNode') return subject.value;
    if (subject.termType === 'BlankNode') return `_:${subject.value}`;
    return subject.value;
  }
  // Build a stable serialization. For sh:path-keyed steps the identity is the
  // path value (shared across sides); for the canonical-bnode-label fallback
  // the identity is the side's raw label, so two sides never accidentally
  // pair.
  const segments = bnodePath.map((step) => {
    const idKind = step.identityIsBlank ? 'bnode' : (step.identityPredicate ?? 'id');
    return `${step.parentPredicate}|${idKind}=${step.identityValue}`;
  });
  return `${anchor} ${segments.join('/')}`;
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

interface SideMaps {
  store: Store;
  forward: Map<string, string> | undefined;
  inverse: Map<string, string> | undefined;
}

function compactRdfListsInHunk(hunk: Hunk, left: SideMaps, right: SideMaps): void {
  // Re-parse each line's nquad once so we can look at subject/object terms.
  // Using `blankNodePrefix: ''` keeps canonical labels (`c14n0`) intact —
  // they must match the canonical labels we map back through `inverse`.
  const parser = new Parser({ format: 'application/n-quads', blankNodePrefix: '' });
  const parsed: { line: HunkLine; quad: Quad }[] = hunk.lines.map((line) => ({
    line,
    quad: parser.parse(line.nquad)[0],
  }));

  // For each line, the raw bnode label of the list HEAD it relates to (if any).
  // Two ways a line relates to a list:
  //   A) object is a bnode that is itself a list head (parent triple)
  //   B) subject is a bnode somewhere along a list spine — walk back via
  //      rdf:rest to find the head
  const lineToListHead = new Map<number, string>();
  for (let i = 0; i < parsed.length; i++) {
    const { line, quad } = parsed[i];
    const sideMaps = line.side === '-' ? left : right;
    if (sideMaps.inverse === undefined) continue;
    const headRaw = listHeadForQuad(quad, sideMaps);
    if (headRaw !== undefined) lineToListHead.set(i, headRaw);
  }

  if (lineToListHead.size === 0) return;

  // Group line indices by (side, listHead).
  const groups = new Map<
    string,
    { side: '-' | '+'; listHead: string; indices: number[] }
  >();
  for (const [idx, listHead] of lineToListHead.entries()) {
    const side = parsed[idx].line.side;
    const key = `${side}|${listHead}`;
    let g = groups.get(key);
    if (g === undefined) {
      g = { side, listHead, indices: [] };
      groups.set(key, g);
    }
    g.indices.push(idx);
  }

  const consumed = new Set<number>();
  const replacements = new Map<number, HunkLine>();
  const fabricated: HunkLine[] = [];

  for (const group of groups.values()) {
    const sideMaps = group.side === '-' ? left : right;
    const list = walkRdfList(group.listHead, sideMaps.store);
    if (list === undefined) continue;
    const itemsSerialized = list.items.map(serializeObject);
    const compactObject = `( ${itemsSerialized.join(' ')} )`;

    // Prefer reusing the existing parent-triple line in this group as the
    // compact line: that preserves its anchor (subjectPath/bnodePath) and
    // source-record provenance.
    let parentIdx: number | undefined;
    for (const idx of group.indices) {
      const { quad } = parsed[idx];
      const pred = quad.predicate.value;
      if (
        quad.object.termType === 'BlankNode' &&
        pred !== RDF_FIRST_IRI &&
        pred !== RDF_REST_IRI
      ) {
        parentIdx = idx;
        break;
      }
    }

    if (parentIdx !== undefined) {
      const parentLine = parsed[parentIdx].line;
      const head = nquadHead(parentLine.nquad);
      replacements.set(parentIdx, {
        ...parentLine,
        object: compactObject,
        nquad: head === undefined ? parentLine.nquad : `${head} ${compactObject} .`,
        listItems: itemsSerialized,
      });
      for (const idx of group.indices) {
        if (idx !== parentIdx) consumed.add(idx);
      }
      continue;
    }

    // No parent triple in the diff — fabricate a compact line from the
    // side's store. This is the case when the list head canonicalizes to
    // the same label on both sides (so the parent triple is not in the
    // diff) but the spine still differs.
    const parentInStore = findListParentTriple(group.listHead, sideMaps.store);
    if (parentInStore === undefined) continue;
    if (
      parentInStore.subject.termType !== 'NamedNode' ||
      parentInStore.subject.value !== hunk.anchor
    ) {
      // Only fabricate when the parent's named subject is this hunk's anchor.
      // Deeper nesting can be added later if needed.
      continue;
    }
    const subjStr = `<${parentInStore.subject.value}>`;
    const predStr = `<${parentInStore.predicate.value}>`;
    const compactNquad = `${subjStr} ${predStr} ${compactObject} .`;
    fabricated.push({
      side: group.side,
      subjectPath: parentInStore.subject.value,
      predicate: parentInStore.predicate.value,
      object: compactObject,
      nquad: compactNquad,
      listItems: itemsSerialized,
    });
    for (const idx of group.indices) consumed.add(idx);
  }

  if (replacements.size === 0 && consumed.size === 0 && fabricated.length === 0) {
    return;
  }

  const next: HunkLine[] = [];
  for (let i = 0; i < parsed.length; i++) {
    if (consumed.has(i)) continue;
    next.push(replacements.get(i) ?? parsed[i].line);
  }
  next.push(...fabricated);
  hunk.lines = next;
  // The hunk's removed/added counts now reflect compacted lines, not raw quads.
  hunk.removed = next.filter((l) => l.side === '-').length;
  hunk.added = next.filter((l) => l.side === '+').length;
}

function listHeadForQuad(quad: Quad, sideMaps: SideMaps): string | undefined {
  const pred = quad.predicate.value;
  // Case A: object is a bnode list head, predicate is non-spine.
  if (
    quad.object.termType === 'BlankNode' &&
    pred !== RDF_FIRST_IRI &&
    pred !== RDF_REST_IRI
  ) {
    const objRaw = sideMaps.inverse?.get(quad.object.value);
    if (objRaw !== undefined && walkRdfList(objRaw, sideMaps.store) !== undefined) {
      return objRaw;
    }
  }
  // Case B: subject is a spine bnode (rdf:first/rdf:rest predicate). Walk
  // backwards via rdf:rest to find the spine's head.
  if (
    quad.subject.termType === 'BlankNode' &&
    (pred === RDF_FIRST_IRI || pred === RDF_REST_IRI)
  ) {
    const subjRaw = sideMaps.inverse?.get(quad.subject.value);
    if (subjRaw === undefined) return undefined;
    return findListHeadFromSpineMember(subjRaw, sideMaps.store);
  }
  return undefined;
}

function findListHeadFromSpineMember(
  spineRaw: string,
  store: Store,
): string | undefined {
  const seen = new Set<string>();
  let current = spineRaw;
  while (!seen.has(current)) {
    seen.add(current);
    const incoming = store.getQuads(
      null,
      DataFactory.namedNode(RDF_REST_IRI),
      DataFactory.blankNode(current),
      null,
    );
    if (incoming.length !== 1) break;
    const parent = incoming[0].subject;
    if (parent.termType !== 'BlankNode') break;
    current = parent.value;
  }
  // Verify `current` is a valid list head: full first/rest chain to nil.
  if (walkRdfList(current, store) === undefined) return undefined;
  return current;
}

function findListParentTriple(
  listHeadRaw: string,
  store: Store,
): Quad | undefined {
  const incoming = store.getQuads(
    null,
    null,
    DataFactory.blankNode(listHeadRaw),
    null,
  );
  return incoming.find(
    (q) =>
      q.predicate.value !== RDF_FIRST_IRI &&
      q.predicate.value !== RDF_REST_IRI,
  );
}

function walkRdfList(
  headRaw: string,
  store: Store,
): { items: Term[]; spine: string[] } | undefined {
  const items: Term[] = [];
  const spine: string[] = [];
  const seen = new Set<string>();
  let current = headRaw;
  while (true) {
    if (seen.has(current)) return undefined;
    seen.add(current);
    const subject = DataFactory.blankNode(current);
    const firsts = store.getQuads(
      subject,
      DataFactory.namedNode(RDF_FIRST_IRI),
      null,
      null,
    );
    const rests = store.getQuads(
      subject,
      DataFactory.namedNode(RDF_REST_IRI),
      null,
      null,
    );
    if (firsts.length !== 1 || rests.length !== 1) return undefined;
    items.push(firsts[0].object);
    spine.push(current);
    const next = rests[0].object;
    if (next.termType === 'NamedNode' && next.value === RDF_NIL_IRI) {
      return { items, spine };
    }
    if (next.termType !== 'BlankNode') return undefined;
    current = next.value;
  }
}

/**
 * Returns the `<subject> <predicate>` prefix of a single-quad N-quad string,
 * or undefined when the input does not parse cleanly into that shape.
 */
function nquadHead(nquad: string): string | undefined {
  // We need to skip the IRI/literal/bnode forms for subject and predicate to
  // find where the object starts. For named subjects + named predicates
  // (the common case for a list parent triple), the first two `<...>` tokens
  // are subject and predicate.
  const trimmed = nquad.trimStart();
  let i = 0;
  const positions: number[] = [];
  for (let token = 0; token < 2; token++) {
    while (i < trimmed.length && /\s/.test(trimmed[i])) i++;
    if (trimmed[i] !== '<') return undefined;
    const close = trimmed.indexOf('>', i);
    if (close === -1) return undefined;
    positions.push(close + 1);
    i = close + 1;
  }
  return trimmed.slice(0, positions[1]);
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
