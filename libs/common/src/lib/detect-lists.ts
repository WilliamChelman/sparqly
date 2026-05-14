import type { Quad, Term } from 'n3';
import { RDF_NS } from './shorten-nquad-line';
import { termKey } from './formatter';

const RDF_FIRST = `${RDF_NS}first`;
const RDF_REST = `${RDF_NS}rest`;
const RDF_NIL = `${RDF_NS}nil`;

export interface DetectedLists {
  lists: Record<string, Term[]>;
  consumed: Set<Quad>;
  listGraphs: Record<string, string>;
}

export function detectLists(quads: ReadonlyArray<Quad>): DetectedLists {
  const lists: Record<string, Term[]> = {};
  const consumed = new Set<Quad>();
  const listGraphs: Record<string, string> = {};

  const byGraph = new Map<string, Quad[]>();
  for (const q of quads) {
    const key = termKey(q.graph);
    let arr = byGraph.get(key);
    if (!arr) byGraph.set(key, (arr = []));
    arr.push(q);
  }
  for (const [graphKey, graphQuads] of byGraph) {
    detectListsInGraph(graphQuads, graphKey, lists, consumed, listGraphs);
  }
  return { lists, consumed, listGraphs };
}

function detectListsInGraph(
  quads: ReadonlyArray<Quad>,
  graphKey: string,
  lists: Record<string, Term[]>,
  consumed: Set<Quad>,
  listGraphs: Record<string, string>,
): void {
  const bySubject = new Map<string, Quad[]>();
  const byObject = new Map<string, Quad[]>();
  for (const q of quads) {
    const sk = termKey(q.subject);
    let s = bySubject.get(sk);
    if (!s) bySubject.set(sk, (s = []));
    s.push(q);
    if (q.object.termType === 'BlankNode') {
      const ok = termKey(q.object);
      let o = byObject.get(ok);
      if (!o) byObject.set(ok, (o = []));
      o.push(q);
    }
  }

  const isListLink = (term: Term): boolean => {
    if (term.termType !== 'BlankNode') return false;
    const out = bySubject.get(termKey(term)) ?? [];
    if (out.length !== 2) return false;
    let f = 0;
    let r = 0;
    for (const q of out) {
      if (q.predicate.termType !== 'NamedNode') continue;
      if (q.predicate.value === RDF_FIRST) f++;
      else if (q.predicate.value === RDF_REST) r++;
    }
    return f === 1 && r === 1;
  };

  const getFirstRest = (
    s: Term,
  ): { first: Term; rest: Term; firstQ: Quad; restQ: Quad } => {
    const out = bySubject.get(termKey(s)) as Quad[];
    let first!: Term;
    let rest!: Term;
    let firstQ!: Quad;
    let restQ!: Quad;
    for (const q of out) {
      if (q.predicate.value === RDF_FIRST) {
        first = q.object;
        firstQ = q;
      } else if (q.predicate.value === RDF_REST) {
        rest = q.object;
        restQ = q;
      }
    }
    return { first, rest, firstQ, restQ };
  };

  for (const q of quads) {
    if (q.subject.termType !== 'BlankNode') continue;
    if (lists[q.subject.value]) continue;
    if (!isListLink(q.subject)) continue;

    const headKey = termKey(q.subject);
    const objRefs = byObject.get(headKey) ?? [];
    let incomingRest = 0;
    let external = 0;
    for (const r of objRefs) {
      const isInternal =
        r.predicate.termType === 'NamedNode' &&
        r.predicate.value === RDF_REST &&
        isListLink(r.subject);
      if (isInternal) incomingRest++;
      else external++;
    }
    if (incomingRest > 0) continue;
    if (external !== 1) continue;

    const elements: Term[] = [];
    const consumedHere: Quad[] = [];
    const visited = new Set<string>();
    let cur: Term = q.subject;
    let ok = false;
    while (cur.termType === 'BlankNode' && isListLink(cur)) {
      const ck = termKey(cur);
      if (visited.has(ck)) break;
      visited.add(ck);

      if (ck !== headKey) {
        const refs = byObject.get(ck) ?? [];
        if (refs.length !== 1) break;
      }

      const fr = getFirstRest(cur);
      elements.push(fr.first);
      consumedHere.push(fr.firstQ, fr.restQ);

      if (fr.rest.termType === 'NamedNode' && fr.rest.value === RDF_NIL) {
        ok = true;
        break;
      }
      cur = fr.rest;
    }

    if (ok) {
      lists[q.subject.value] = elements;
      listGraphs[q.subject.value] = graphKey;
      for (const cq of consumedHere) consumed.add(cq);
    }
  }
}
