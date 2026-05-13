import type { Quad, Term } from 'n3';
import type { Term as CoreTerm } from '@app/core';
import {
  describeBnodePath,
  isExpandableBnode,
  MAX_EXPANSION_PATH_STEPS,
  type DescribeBnodePathResult,
} from './describe-bnode-path';

/**
 * Describe sections (PRD #221, slice #222 — flat).
 *
 * Pure quads → view-model builder for the describe page's `table` tab. The
 * already-stripped describe quads are partitioned into `outbound` (seed in
 * subject position) and `inbound` (seed in object position), grouped by
 * predicate within each section, and the predicate groups / members are sorted
 * for a stable, Turtle-like reading order.
 *
 * Nesting (inline `[ … ]`), `rdf:List` collapse, RDF-star annotations, and the
 * `⤵ expand` affordance are stubs in this slice — the corresponding fields are
 * present on the view model but always `null`/empty. The follow-up slice fills
 * them in.
 */

export interface SectionMember {
  /** Outbound: the object. Inbound: the subject. */
  readonly term: CoreTerm;
  readonly origins: readonly string[];
  /** Named graph for this quad, or `null` for the default graph. */
  readonly graph: CoreTerm | null;
  /**
   * Inline subtree for a blank-node member.
   *  - `BnodeBlock` with `label: null` → single-use, render `[ … ]`.
   *  - `BnodeBlock` with `label: "_:b1"` and populated groups → labeled canonical site (`_:b1 [ … ]`).
   *  - `BnodeBlock` with `label: "_:b1"` and empty groups → back-reference or empty labeled bnode (`_:b1`).
   *  - `CollectionBlock` → `( … )` collapsed `rdf:List`.
   *  - `null` → named IRI or literal member.
   */
  readonly nested: NestedBlock | null;
  /** Stub — RDF-star annotation rendering arrives in the follow-up slice. */
  readonly annotations: readonly never[];
  /**
   * Predicate-pinned path to this bnode + originating source id, when the
   * member is a dangling endpoint-origin blank node within the path-step cap;
   * otherwise `null`. Drives the `⤵ expand` affordance in the component
   * (ADR-0019).
   */
  readonly expand: DescribeBnodePathResult | null;
}

export type NestedBlock = BnodeBlock | CollectionBlock;

export interface BnodeBlock {
  readonly kind: 'bnode';
  readonly label: string | null;
  readonly predicateGroups: readonly PredicateGroup[];
}

export interface CollectionBlock {
  readonly kind: 'collection';
  readonly items: readonly CollectionItem[];
}

export interface CollectionItem {
  readonly term: CoreTerm;
  readonly nested: NestedBlock | null;
}

export interface PredicateGroup {
  /** Expanded IRI; the page-level component decides how to render it (`a` for
   *  `rdf:type` in outbound; inverse-arrow prefix in inbound). */
  readonly predicate: string;
  readonly predicateTerm: CoreTerm;
  readonly members: readonly SectionMember[];
}

export interface Section {
  readonly direction: 'outbound' | 'inbound';
  /** Number of quads in this section (matches the per-section heading text). */
  readonly count: number;
  readonly predicateGroups: readonly PredicateGroup[];
}

export interface DescribeSections {
  readonly outbound: Section;
  readonly inbound: Section;
}

// Wire terms are always NamedNode / BlankNode / Literal in describe results;
// the n3 union over Variable never appears here.
function asCoreTerm<T extends { termType: string; value: string }>(t: T): CoreTerm {
  return t as unknown as CoreTerm;
}

interface GroupAccumulator {
  readonly predicateTerm: CoreTerm;
  readonly members: SectionMember[];
}

function newMember(
  memberTerm: Term,
  graph: Term,
  origins: readonly string[],
  nested: NestedBlock | null,
  ctx: BuildCtx,
): SectionMember {
  return {
    term: asCoreTerm(memberTerm),
    origins,
    graph: graph.termType === 'DefaultGraph' ? null : asCoreTerm(graph),
    nested,
    annotations: [],
    expand: computeExpand(memberTerm, ctx),
  };
}

function computeExpand(
  memberTerm: Term,
  ctx: BuildCtx,
): DescribeBnodePathResult | null {
  if (memberTerm.termType !== 'BlankNode') return null;
  if (!isExpandableBnode(ctx.quads, memberTerm.value, ctx.endpointSourceIds)) {
    return null;
  }
  const result = describeBnodePath(ctx.quads, memberTerm.value, ctx.seed);
  if (result === null) return null;
  if (result.path.length > MAX_EXPANSION_PATH_STEPS) return null;
  return result;
}

function quadKey(q: Quad): string {
  return `${termKeyOf(q.subject)} ${termKeyOf(q.predicate)} ${termKeyOf(q.object)} ${termKeyOf(q.graph)}`;
}
function termKeyOf(t: Term): string {
  return `${t.termType}:${t.value}`;
}

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDF_FIRST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
const RDF_REST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest';
const RDF_NIL = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil';

function memberRank(termType: string): number {
  if (termType === 'NamedNode') return 0;
  if (termType === 'Literal') return 1;
  return 2; // BlankNode
}

function compareMembers(a: SectionMember, b: SectionMember): number {
  const ra = memberRank(a.term.termType);
  const rb = memberRank(b.term.termType);
  if (ra !== rb) return ra - rb;
  return a.term.value.localeCompare(b.term.value);
}

function comparePredicate(direction: 'outbound' | 'inbound', a: string, b: string): number {
  if (direction === 'outbound') {
    if (a === RDF_TYPE && b !== RDF_TYPE) return -1;
    if (b === RDF_TYPE && a !== RDF_TYPE) return 1;
  }
  return a.localeCompare(b);
}

interface BuildCtx {
  readonly originsByQuad: ReadonlyMap<string, readonly string[]>;
  readonly bnodeOutgoing: ReadonlyMap<string, readonly Quad[]>;
  /** Number of times each bnode label appears as the object of any quad.
   *  Count > 1 ⇒ render as labeled `_:b` (multi-reference). */
  readonly bnodeRefCount: ReadonlyMap<string, number>;
  /** All describe quads (already stripped of provenance), for expand-target
   *  attribution via `describeBnodePath` / `isExpandableBnode`. */
  readonly quads: ReadonlyArray<Quad>;
  readonly seed: string;
  readonly endpointSourceIds: ReadonlySet<string>;
}

function indexBnodeOutgoing(quads: ReadonlyArray<Quad>): Map<string, Quad[]> {
  const out = new Map<string, Quad[]>();
  for (const q of quads) {
    if (q.subject.termType !== 'BlankNode') continue;
    let arr = out.get(q.subject.value);
    if (!arr) {
      arr = [];
      out.set(q.subject.value, arr);
    }
    arr.push(q);
  }
  return out;
}

function indexBnodeRefCount(quads: ReadonlyArray<Quad>): Map<string, number> {
  const out = new Map<string, number>();
  for (const q of quads) {
    if (q.object.termType === 'BlankNode') {
      out.set(q.object.value, (out.get(q.object.value) ?? 0) + 1);
    }
  }
  return out;
}

/** A bnode is a list link iff its outgoing fan is exactly `{rdf:first, rdf:rest}`. */
function isListLink(bnodeLabel: string, ctx: BuildCtx): boolean {
  const outgoing = ctx.bnodeOutgoing.get(bnodeLabel) ?? [];
  if (outgoing.length !== 2) return false;
  let firstCount = 0;
  let restCount = 0;
  for (const q of outgoing) {
    if (q.predicate.termType !== 'NamedNode') continue;
    if (q.predicate.value === RDF_FIRST) firstCount++;
    else if (q.predicate.value === RDF_REST) restCount++;
  }
  return firstCount === 1 && restCount === 1;
}

function getFirstRest(
  bnodeLabel: string,
  ctx: BuildCtx,
): { first: Term; rest: Term } | null {
  const outgoing = ctx.bnodeOutgoing.get(bnodeLabel) ?? [];
  let first: Term | null = null;
  let rest: Term | null = null;
  for (const q of outgoing) {
    if (q.predicate.value === RDF_FIRST) first = q.object;
    else if (q.predicate.value === RDF_REST) rest = q.object;
  }
  return first && rest ? { first, rest } : null;
}

/**
 * Try to collapse the `rdf:first`/`rdf:rest`/`rdf:nil` chain rooted at
 * `headLabel` into a `CollectionBlock`. Returns null when the chain is
 * non-conforming (cycle, missing rest, or a `rdf:rest` to something other than
 * another list link or `rdf:nil`); callers fall back to a plain `BnodeBlock`.
 */
function tryBuildListBlock(
  headLabel: string,
  ctx: BuildCtx,
  emitted: Set<string>,
): CollectionBlock | null {
  if (!isListLink(headLabel, ctx)) return null;
  const items: CollectionItem[] = [];
  const visited = new Set<string>();
  let curLabel = headLabel;
  while (true) {
    if (visited.has(curLabel)) return null;
    visited.add(curLabel);
    if (!isListLink(curLabel, ctx)) return null;
    const fr = getFirstRest(curLabel, ctx);
    if (!fr) return null;
    const itemNested: NestedBlock | null =
      fr.first.termType === 'BlankNode'
        ? buildNestedForBnode(fr.first.value, ctx, emitted)
        : null;
    items.push({ term: asCoreTerm(fr.first), nested: itemNested });
    // Mark this link's label as emitted so the outer walker never produces a
    // separate `[ … ]` block for it (its `rdf:first`/`rdf:rest` quads have been
    // folded into the collection).
    emitted.add(curLabel);
    if (fr.rest.termType === 'NamedNode' && fr.rest.value === RDF_NIL) {
      return { kind: 'collection', items };
    }
    if (fr.rest.termType !== 'BlankNode') return null;
    curLabel = fr.rest.value;
  }
}

function buildNestedForBnode(
  bnodeLabel: string,
  ctx: BuildCtx,
  emitted: Set<string>,
): NestedBlock {
  if (!emitted.has(bnodeLabel)) {
    const list = tryBuildListBlock(bnodeLabel, ctx, emitted);
    if (list) return list;
  }
  return buildBnodeBlock(bnodeLabel, ctx, emitted);
}

/**
 * Build a `BnodeBlock` for `bnodeLabel`. `emitted` tracks bnode labels whose
 * canonical block has already been emitted along the current section walk —
 * revisiting a label always yields a labeled back-reference (empty groups),
 * which terminates cycles and prevents a multi-reference bnode's subtree from
 * being duplicated within the same section.
 */
function buildBnodeBlock(
  bnodeLabel: string,
  ctx: BuildCtx,
  emitted: Set<string>,
): BnodeBlock {
  const isMultiRef = (ctx.bnodeRefCount.get(bnodeLabel) ?? 0) > 1;
  const blockLabel = isMultiRef ? bnodeLabel : null;
  if (emitted.has(bnodeLabel)) {
    return { kind: 'bnode', label: bnodeLabel, predicateGroups: [] };
  }
  emitted.add(bnodeLabel);
  const outgoing = ctx.bnodeOutgoing.get(bnodeLabel) ?? [];
  const groups = new Map<string, GroupAccumulator>();
  for (const q of outgoing) {
    const p = q.predicate.value;
    let acc = groups.get(p);
    if (!acc) {
      acc = { predicateTerm: asCoreTerm(q.predicate), members: [] };
      groups.set(p, acc);
    }
    const origins = ctx.originsByQuad.get(quadKey(q)) ?? [];
    const nested: NestedBlock | null =
      q.object.termType === 'BlankNode'
        ? buildNestedForBnode(q.object.value, ctx, emitted)
        : null;
    acc.members.push(newMember(q.object, q.graph, origins, nested, ctx));
  }
  const predicateGroups: PredicateGroup[] = [...groups]
    .map(([predicate, acc]) => ({
      predicate,
      predicateTerm: acc.predicateTerm,
      members: [...acc.members].sort(compareMembers),
    }))
    .sort((a, b) => comparePredicate('outbound', a.predicate, b.predicate));
  return { kind: 'bnode', label: blockLabel, predicateGroups };
}

interface RawMember {
  readonly quad: Quad;
  readonly memberTerm: Term;
  readonly origins: readonly string[];
}

function buildSection(
  direction: 'outbound' | 'inbound',
  selected: ReadonlyArray<Quad>,
  ctx: BuildCtx,
): Section {
  const raw = new Map<
    string,
    { predicateTerm: CoreTerm; members: RawMember[] }
  >();
  for (const q of selected) {
    const p = q.predicate.value;
    let acc = raw.get(p);
    if (!acc) {
      acc = { predicateTerm: asCoreTerm(q.predicate), members: [] };
      raw.set(p, acc);
    }
    const memberTerm = direction === 'outbound' ? q.object : q.subject;
    const origins = ctx.originsByQuad.get(quadKey(q)) ?? [];
    acc.members.push({ quad: q, memberTerm, origins });
  }
  const emitted = new Set<string>();
  const predicateGroups: PredicateGroup[] = [...raw]
    .sort(([a], [b]) => comparePredicate(direction, a, b))
    .map(([predicate, acc]) => {
      const sortedRaw = [...acc.members].sort(compareRawMembers);
      const members = sortedRaw.map((rm) => {
        const nested: NestedBlock | null =
          rm.memberTerm.termType === 'BlankNode'
            ? buildNestedForBnode(rm.memberTerm.value, ctx, emitted)
            : null;
        return newMember(rm.memberTerm, rm.quad.graph, rm.origins, nested, ctx);
      });
      return { predicate, predicateTerm: acc.predicateTerm, members };
    });
  return { direction, count: selected.length, predicateGroups };
}

function compareRawMembers(a: RawMember, b: RawMember): number {
  const ra = memberRank(a.memberTerm.termType);
  const rb = memberRank(b.memberTerm.termType);
  if (ra !== rb) return ra - rb;
  return a.memberTerm.value.localeCompare(b.memberTerm.value);
}

export function buildDescribeSections(
  quads: ReadonlyArray<Quad>,
  originsByQuad: ReadonlyMap<string, readonly string[]>,
  seed: string,
  endpointSourceIds: ReadonlySet<string>,
): DescribeSections {
  const outboundQuads: Quad[] = [];
  const inboundQuads: Quad[] = [];
  for (const q of quads) {
    const subjectIsSeed = q.subject.termType === 'NamedNode' && q.subject.value === seed;
    const objectIsSeed = q.object.termType === 'NamedNode' && q.object.value === seed;
    if (subjectIsSeed) outboundQuads.push(q);
    else if (objectIsSeed) inboundQuads.push(q);
  }
  const ctx: BuildCtx = {
    originsByQuad,
    bnodeOutgoing: indexBnodeOutgoing(quads),
    bnodeRefCount: indexBnodeRefCount(quads),
    quads,
    seed,
    endpointSourceIds,
  };
  return {
    outbound: buildSection('outbound', outboundQuads, ctx),
    inbound: buildSection('inbound', inboundQuads, ctx),
  };
}
