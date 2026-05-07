import { DataFactory, Parser, type Quad, type Store, type Term } from 'n3';
import type { DiffTotals, RdfDiffWithSourcesResult, SourceRecord } from './diff';

const RDF_TYPE_IRI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const SH_PATH_IRI = 'http://www.w3.org/ns/shacl#path';

export interface HunkedRdfDiff {
  /**
   * Hunks for entities that exist on both sides — i.e. paired changes. This
   * is the most informative case and is rendered first.
   */
  changed: Hunk[];
  /** Hunks for entities present only on the left side. */
  removed: Hunk[];
  /** Hunks for entities present only on the right side. */
  added: Hunk[];
  totals: DiffTotals;
}

export interface Hunk {
  /** Full IRI of the named entity that owns this hunk. */
  anchor: string;
  /** Full IRI of `rdf:type` for the anchor, when present on either side. */
  rdfType?: string;
  /**
   * Section assignment derived from whether the anchor exists on both sides
   * (`changed`) or only on the left/right (`removed` / `added`). Mirrors the
   * section the hunk lives in.
   */
  state: 'changed' | 'removed' | 'added';
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
  const seenSourceRecords = new Map<string, Set<string>>(); // anchor -> set of "side|file|line"

  // Invert canonical→raw bnode labels per side so we can locate a changed
  // canonical bnode subject in the side's raw Store and walk up its parent
  // chain. Absent when the diff was built via `diffCanonicalStatements`,
  // in which case we keep the MVP behavior (skip bnode-rooted changes).
  const inverseLeft = invertCanonicalIdMap(diff.canonicalIdMap?.left);
  const inverseRight = invertCanonicalIdMap(diff.canonicalIdMap?.right);

  function ensureHunk(anchor: string): Hunk {
    let h = hunks.get(anchor);
    if (h === undefined) {
      h = {
        anchor,
        state: 'changed',
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
    const sideStore = side === '-' ? left.store : right.store;
    const sideInverse = side === '-' ? inverseLeft : inverseRight;
    const resolved = resolveAnchor(q, sideStore, sideInverse);
    if (resolved === undefined) return;
    const { anchor, bnodePath } = resolved;
    const hunk = ensureHunk(anchor);
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

  const changed: Hunk[] = [];
  const removedSection: Hunk[] = [];
  const addedSection: Hunk[] = [];

  for (const hunk of hunks.values()) {
    hunk.lines.sort(compareHunkLines);
    const rdfType = lookupRdfType(hunk.anchor, right.store, left.store);
    if (rdfType !== undefined) hunk.rdfType = rdfType;
    const onLeft = anchorPresentInStore(hunk.anchor, left.store);
    const onRight = anchorPresentInStore(hunk.anchor, right.store);
    if (onLeft && !onRight) {
      hunk.state = 'removed';
      removedSection.push(hunk);
    } else if (!onLeft && onRight) {
      hunk.state = 'added';
      addedSection.push(hunk);
    } else {
      hunk.state = 'changed';
      changed.push(hunk);
    }
  }

  const byAnchor = (a: Hunk, b: Hunk): number =>
    a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0;
  changed.sort(byAnchor);
  removedSection.sort(byAnchor);
  addedSection.sort(byAnchor);

  return {
    changed,
    removed: removedSection,
    added: addedSection,
    totals: diff.totals,
  };
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
}

function resolveAnchor(
  q: Quad,
  store: Store,
  inverseCanonicalIdMap: Map<string, string> | undefined,
): ResolvedAnchor | undefined {
  if (q.subject.termType === 'NamedNode') {
    return { anchor: q.subject.value, bnodePath: [] };
  }
  if (q.subject.termType !== 'BlankNode') return undefined;
  if (inverseCanonicalIdMap === undefined) return undefined;
  // The diff exposes canonical bnode labels (e.g. `c14n0`); walk the parent
  // chain in the side's raw Store, where bnodes carry their original parser
  // labels. Map canonical → raw via the inverted canonicalIdMap.
  const canonicalLabel = q.subject.value;
  const rawLabel = inverseCanonicalIdMap.get(canonicalLabel);
  if (rawLabel === undefined) return undefined;
  return walkToNamedAncestor(rawLabel, store);
}

function walkToNamedAncestor(
  startRawLabel: string,
  store: Store,
): ResolvedAnchor | undefined {
  // Climb from the bnode toward a named ancestor, recording each hop's
  // (parentPredicate, identity) so child-bnode lines can be rendered with a
  // path notation and so cross-side pairing is keyed on stable identity
  // (sh:path value when present, canonical bnode label otherwise).
  const visited = new Set<string>();
  // Reverse path: hops are appended deepest-first; we reverse before return.
  const reversedHops: BnodePathStep[] = [];
  let currentRaw = startRawLabel;
  while (true) {
    if (visited.has(currentRaw)) return undefined;
    visited.add(currentRaw);
    const incoming = store.getQuads(
      null,
      null,
      DataFactory.blankNode(currentRaw),
      null,
    );
    if (incoming.length === 0) return undefined;
    // Prefer named-node parents; otherwise pick a deterministic bnode parent
    // (lex by raw label) and recurse.
    const namedParent = incoming.find(
      (qq) => qq.subject.termType === 'NamedNode',
    );
    const step = bnodeStepFor(currentRaw, store);
    if (namedParent !== undefined) {
      reversedHops.push({ ...step, parentPredicate: namedParent.predicate.value });
      const path: BnodePathStep[] = [];
      for (let i = reversedHops.length - 1; i >= 0; i--) path.push(reversedHops[i]);
      return { anchor: namedParent.subject.value, bnodePath: path };
    }
    const bnodeParents = incoming.filter(
      (qq) => qq.subject.termType === 'BlankNode',
    );
    if (bnodeParents.length === 0) return undefined;
    bnodeParents.sort((a, b) =>
      a.subject.value < b.subject.value ? -1 : a.subject.value > b.subject.value ? 1 : 0,
    );
    const next = bnodeParents[0];
    reversedHops.push({ ...step, parentPredicate: next.predicate.value });
    currentRaw = next.subject.value;
  }
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
