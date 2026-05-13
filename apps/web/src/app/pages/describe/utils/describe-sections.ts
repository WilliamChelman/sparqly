import type { Quad, Term } from 'n3';
import type { Term as CoreTerm } from '@app/core';

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
  /** Stub — inline `[ … ]` nesting arrives in the follow-up slice. */
  readonly nested: null;
  /** Stub — RDF-star annotation rendering arrives in the follow-up slice. */
  readonly annotations: readonly never[];
  /** Stub — the `⤵ expand` target arrives in the follow-up slice. */
  readonly expand: null;
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
): SectionMember {
  return {
    term: asCoreTerm(memberTerm),
    origins,
    graph: graph.termType === 'DefaultGraph' ? null : asCoreTerm(graph),
    nested: null,
    annotations: [],
    expand: null,
  };
}

function quadKey(q: Quad): string {
  return `${termKeyOf(q.subject)} ${termKeyOf(q.predicate)} ${termKeyOf(q.object)} ${termKeyOf(q.graph)}`;
}
function termKeyOf(t: Term): string {
  return `${t.termType}:${t.value}`;
}

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

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

function buildSection(
  direction: 'outbound' | 'inbound',
  selected: ReadonlyArray<Quad>,
  originsByQuad: ReadonlyMap<string, readonly string[]>,
): Section {
  const groups = new Map<string, GroupAccumulator>();
  for (const q of selected) {
    const p = q.predicate.value;
    let acc = groups.get(p);
    if (!acc) {
      acc = { predicateTerm: asCoreTerm(q.predicate), members: [] };
      groups.set(p, acc);
    }
    const origins = originsByQuad.get(quadKey(q)) ?? [];
    acc.members.push(
      newMember(direction === 'outbound' ? q.object : q.subject, q.graph, origins),
    );
  }
  const predicateGroups: PredicateGroup[] = [...groups]
    .map(([predicate, acc]) => ({
      predicate,
      predicateTerm: acc.predicateTerm,
      members: [...acc.members].sort(compareMembers),
    }))
    .sort((a, b) => comparePredicate(direction, a.predicate, b.predicate));
  return {
    direction,
    count: selected.length,
    predicateGroups,
  };
}

export function buildDescribeSections(
  quads: ReadonlyArray<Quad>,
  originsByQuad: ReadonlyMap<string, readonly string[]>,
  seed: string,
  _endpointSourceIds: ReadonlySet<string>,
): DescribeSections {
  const outboundQuads: Quad[] = [];
  const inboundQuads: Quad[] = [];
  for (const q of quads) {
    const subjectIsSeed = q.subject.termType === 'NamedNode' && q.subject.value === seed;
    const objectIsSeed = q.object.termType === 'NamedNode' && q.object.value === seed;
    if (subjectIsSeed) outboundQuads.push(q);
    else if (objectIsSeed) inboundQuads.push(q);
  }
  return {
    outbound: buildSection('outbound', outboundQuads, originsByQuad),
    inbound: buildSection('inbound', inboundQuads, originsByQuad),
  };
}
