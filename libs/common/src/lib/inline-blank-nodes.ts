import { DataFactory, type Quad, type Term, type Writer } from 'n3';
import { comparePredicate, compareTerm, termKey } from './formatter';

export function inlineSingleUseBlankNodes(
  quads: ReadonlyArray<Quad>,
  writer: Writer,
  lists: Record<string, Term[]>,
  listGraphs: Record<string, string>,
): Quad[] {
  const incomingByObject = new Map<string, Quad[]>();
  const outgoingBySubject = new Map<string, { graphKey: string; quads: Quad[] }>();
  const blankAsGraph = new Set<string>();

  for (const q of quads) {
    if (q.object.termType === 'BlankNode') {
      const k = q.object.value;
      let arr = incomingByObject.get(k);
      if (!arr) incomingByObject.set(k, (arr = []));
      arr.push(q);
    }
    if (q.subject.termType === 'BlankNode') {
      const label = q.subject.value;
      const gk = termKey(q.graph);
      const existing = outgoingBySubject.get(label);
      if (!existing) {
        outgoingBySubject.set(label, { graphKey: gk, quads: [q] });
      } else if (existing.graphKey === gk) {
        existing.quads.push(q);
      } else {
        existing.graphKey = '__multi__';
      }
    }
    if (q.graph.termType === 'BlankNode') blankAsGraph.add(q.graph.value);
  }

  // Where each blank-node label appears as a list element. The list
  // compaction itself counts as one incoming reference for the BN.
  const listElemAppearances = new Map<
    string,
    { head: string; index: number; graphKey: string }[]
  >();
  for (const head of Object.keys(lists)) {
    const elements = lists[head];
    const graphKey = listGraphs[head];
    for (let i = 0; i < elements.length; i++) {
      const e = elements[i];
      if (e.termType !== 'BlankNode') continue;
      // A BN that is itself a list head will be pretty-printed as a sublist
      // by the writer; skip — it isn't a single-use BN candidate.
      if (lists[e.value]) continue;
      let arr = listElemAppearances.get(e.value);
      if (!arr) listElemAppearances.set(e.value, (arr = []));
      arr.push({ head, index: i, graphKey });
    }
  }

  const candidates = new Set<string>();
  for (const [label, refs] of incomingByObject) {
    if (refs.length !== 1) continue;
    if (listElemAppearances.has(label)) continue;
    if (blankAsGraph.has(label)) continue;
    if (lists[label]) continue;
    const out = outgoingBySubject.get(label);
    if (out && out.graphKey === '__multi__') continue;
    if (out && out.graphKey !== termKey(refs[0].graph)) continue;
    candidates.add(label);
  }
  for (const [label, appearances] of listElemAppearances) {
    if (appearances.length !== 1) continue;
    if (incomingByObject.has(label)) continue;
    if (blankAsGraph.has(label)) continue;
    if (lists[label]) continue;
    const out = outgoingBySubject.get(label);
    if (out && out.graphKey === '__multi__') continue;
    if (out && out.graphKey !== appearances[0].graphKey) continue;
    candidates.add(label);
  }

  const inlineTerm = new Map<string, Term>();
  const buildInline = (label: string): Term => {
    const cached = inlineTerm.get(label);
    if (cached) return cached;
    const out = outgoingBySubject.get(label);
    const items: { predicate: Term; object: Term }[] = [];
    if (out && out.graphKey !== '__multi__') {
      const sortedOut = [...out.quads].sort(
        (a, b) =>
          comparePredicate(a.predicate, b.predicate) ||
          compareTerm(a.object, b.object),
      );
      for (const q of sortedOut) {
        let object: Term = q.object;
        if (q.object.termType === 'BlankNode' && candidates.has(q.object.value)) {
          object = buildInline(q.object.value);
        }
        items.push({ predicate: q.predicate, object });
      }
    }
    const term = (writer as unknown as {
      blank(items: { predicate: Term; object: Term }[]): Term;
    }).blank(items);
    inlineTerm.set(label, term);
    return term;
  };
  for (const label of candidates) buildInline(label);

  // Swap inline terms into list elements so the writer emits `[ … ]` in place
  // of `_:bN` when a candidate BN appeared as a list element.
  for (const [label, appearances] of listElemAppearances) {
    if (!candidates.has(label)) continue;
    const term = inlineTerm.get(label);
    if (!term) continue;
    for (const { head, index } of appearances) {
      lists[head][index] = term;
    }
  }

  const result: Quad[] = [];
  for (const q of quads) {
    if (q.subject.termType === 'BlankNode' && candidates.has(q.subject.value)) {
      continue;
    }
    if (q.object.termType === 'BlankNode' && candidates.has(q.object.value)) {
      result.push(
        DataFactory.quad(
          q.subject as Quad['subject'],
          q.predicate as Quad['predicate'],
          inlineTerm.get(q.object.value) as Quad['object'],
          q.graph as Quad['graph'],
        ),
      );
    } else {
      result.push(q);
    }
  }
  return result;
}
