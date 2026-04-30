import { DataFactory, Writer, type Quad, type Term } from 'n3';

export type FormatSerialization = 'turtle' | 'trig';

export interface ResolvedFormatterConfig {
  prefixes: Record<string, string>;
  base?: string;
  /**
   * Predicate IRIs (or CURIEs resolvable against `prefixes`) whose triples
   * are emitted next to the object's description block instead of the
   * subject's, so a `(s, p, o)` reference reads top-down with `o`'s own
   * block immediately below it. Only applies when `o` is a NamedNode.
   */
  objectAnchoredPredicates?: ReadonlyArray<string>;
}

const SERIALIZATION_TO_FORMAT: Record<FormatSerialization, string> = {
  turtle: 'text/turtle',
  trig: 'application/trig',
};

export function formatRdf(
  quads: Iterable<Quad>,
  serialization: FormatSerialization,
  config: ResolvedFormatterConfig,
): string {
  const list = normalizeBlankLabels(Array.from(quads));
  if (list.length === 0) return '';

  const { lists, consumed } = detectLists(list);
  const remaining = list.filter((q) => !consumed.has(q));

  const writer = new Writer({
    format: SERIALIZATION_TO_FORMAT[serialization],
    prefixes: pickUsedPrefixes(remaining, config.prefixes),
    baseIRI: config.base,
    lists,
  } as ConstructorParameters<typeof Writer>[0] & {
    lists: Record<string, Term[]>;
  });

  const inlined = inlineSingleUseBlankNodes(remaining, writer, lists);
  const anchorIris = resolveAnchorIris(
    config.objectAnchoredPredicates,
    config.prefixes,
  );
  const sorted = [...inlined].sort((a, b) => compareForEmission(a, b, anchorIris));
  let prevBlock: string | null = null;
  let prevGraphKey: string | null = null;
  for (const q of sorted) {
    const gk = termKey(q.graph);
    const bk = blockKey(q, anchorIris);
    // The N3 Writer joins consecutive same-subject quads with `;`. When a
    // block boundary falls across two same-subject quads (a normal triple
    // followed by an object-anchored one with the same subject) we have to
    // force a paragraph break ourselves so the anchored line stands alone.
    if (prevBlock !== null && prevGraphKey === gk && prevBlock !== bk) {
      forceSubjectBreak(writer);
    }
    writer.addQuad(q);
    prevBlock = bk;
    prevGraphKey = gk;
  }

  let body = '';
  writer.end((error, result) => {
    if (error) throw error;
    body = result;
  });
  return config.base ? `@base <${config.base}>.\n${body}` : body;
}

function pickUsedPrefixes(
  quads: ReadonlyArray<Quad>,
  prefixes: Record<string, string>,
): Record<string, string> {
  const entries = Object.entries(prefixes);
  if (entries.length === 0) return {};

  const usedNames = new Set<string>();
  for (const q of quads) {
    for (const term of [q.subject, q.predicate, q.object, q.graph]) {
      const name = bestPrefixFor(term, entries);
      if (name) usedNames.add(name);
    }
  }

  const out: Record<string, string> = {};
  for (const [name, iri] of entries) {
    if (usedNames.has(name)) out[name] = iri;
  }
  return out;
}

function normalizeBlankLabels(quads: ReadonlyArray<Quad>): Quad[] {
  if (quads.length === 0) return [];
  const sorted = [...quads].sort(compareQuads);
  const map = new Map<string, Term>();
  let counter = 0;
  const remap = (t: Term): Term => {
    if (t.termType !== 'BlankNode') return t;
    let mapped = map.get(t.value);
    if (!mapped) {
      mapped = DataFactory.blankNode(`b${counter++}`);
      map.set(t.value, mapped);
    }
    return mapped;
  };
  for (const q of sorted) {
    remap(q.subject);
    remap(q.object);
    remap(q.graph);
  }
  if (map.size === 0) return [...quads];
  return quads.map((q) =>
    DataFactory.quad(
      remap(q.subject) as Quad['subject'],
      q.predicate as Quad['predicate'],
      remap(q.object) as Quad['object'],
      remap(q.graph) as Quad['graph'],
    ),
  );
}

const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDF_TYPE = `${RDF_NS}type`;
const RDF_FIRST = `${RDF_NS}first`;
const RDF_REST = `${RDF_NS}rest`;
const RDF_NIL = `${RDF_NS}nil`;

interface DetectedLists {
  lists: Record<string, Term[]>;
  consumed: Set<Quad>;
}

function detectLists(quads: ReadonlyArray<Quad>): DetectedLists {
  const lists: Record<string, Term[]> = {};
  const consumed = new Set<Quad>();

  const byGraph = new Map<string, Quad[]>();
  for (const q of quads) {
    const key = termKey(q.graph);
    let arr = byGraph.get(key);
    if (!arr) byGraph.set(key, (arr = []));
    arr.push(q);
  }
  for (const graphQuads of byGraph.values()) {
    detectListsInGraph(graphQuads, lists, consumed);
  }
  return { lists, consumed };
}

function detectListsInGraph(
  quads: ReadonlyArray<Quad>,
  lists: Record<string, Term[]>,
  consumed: Set<Quad>,
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
      for (const cq of consumedHere) consumed.add(cq);
    }
  }
}

function inlineSingleUseBlankNodes(
  quads: ReadonlyArray<Quad>,
  writer: Writer,
  lists: Record<string, Term[]>,
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

  const candidates = new Set<string>();
  for (const [label, refs] of incomingByObject) {
    if (refs.length !== 1) continue;
    if (blankAsGraph.has(label)) continue;
    if (lists[label]) continue;
    const out = outgoingBySubject.get(label);
    if (out && out.graphKey === '__multi__') continue;
    if (out && out.graphKey !== termKey(refs[0].graph)) continue;
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

function compareQuads(a: Quad, b: Quad): number {
  return (
    compareTerm(a.graph, b.graph) ||
    compareTerm(a.subject, b.subject) ||
    comparePredicate(a.predicate, b.predicate) ||
    compareTerm(a.object, b.object)
  );
}

function resolveAnchorIris(
  predicates: ReadonlyArray<string> | undefined,
  prefixes: Record<string, string>,
): Set<string> {
  if (!predicates || predicates.length === 0) return new Set();
  const out = new Set<string>();
  for (const value of predicates) {
    const colonIdx = value.indexOf(':');
    if (colonIdx === -1) {
      out.add(value);
      continue;
    }
    const prefix = value.slice(0, colonIdx);
    const ns = prefixes[prefix];
    out.add(ns ? ns + value.slice(colonIdx + 1) : value);
  }
  return out;
}

function isAnchored(q: Quad, anchorIris: Set<string>): boolean {
  if (anchorIris.size === 0) return false;
  if (q.predicate.termType !== 'NamedNode') return false;
  if (q.object.termType !== 'NamedNode') return false;
  return anchorIris.has(q.predicate.value);
}

function blockKey(q: Quad, anchorIris: Set<string>): string {
  return isAnchored(q, anchorIris)
    ? `A:${termKey(q.object)}`
    : `N:${termKey(q.subject)}`;
}

function forceSubjectBreak(writer: Writer): void {
  const w = writer as unknown as {
    _subject: Term | null;
    _write(s: string, done?: unknown): void;
  };
  if (w._subject !== null) {
    w._write('.\n');
    w._subject = null;
  }
}

function compareForEmission(
  a: Quad,
  b: Quad,
  anchorIris: Set<string>,
): number {
  const graphCmp = compareTerm(a.graph, b.graph);
  if (graphCmp !== 0) return graphCmp;
  const aAnchored = isAnchored(a, anchorIris);
  const bAnchored = isAnchored(b, anchorIris);
  const aPrimary = aAnchored ? a.object : a.subject;
  const bPrimary = bAnchored ? b.object : b.subject;
  const primaryCmp = compareTerm(aPrimary, bPrimary);
  if (primaryCmp !== 0) return primaryCmp;
  // Same anchor target — anchored references are emitted before the
  // target's own outgoing block so the reference and its description sit
  // next to each other in the output.
  if (aAnchored !== bAnchored) return aAnchored ? -1 : 1;
  return (
    compareTerm(a.subject, b.subject) ||
    comparePredicate(a.predicate, b.predicate) ||
    compareTerm(a.object, b.object)
  );
}

function comparePredicate(a: Term, b: Term): number {
  const aIsType = a.termType === 'NamedNode' && a.value === RDF_TYPE;
  const bIsType = b.termType === 'NamedNode' && b.value === RDF_TYPE;
  if (aIsType && !bIsType) return -1;
  if (!aIsType && bIsType) return 1;
  return compareTerm(a, b);
}

function compareTerm(a: Term, b: Term): number {
  const aKey = termKey(a);
  const bKey = termKey(b);
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}

function termKey(term: Term): string {
  switch (term.termType) {
    case 'DefaultGraph':
      return '0:';
    case 'NamedNode':
      return `1:${term.value}`;
    case 'BlankNode':
      return `2:${term.value}`;
    case 'Literal': {
      const lit = term as Term & {
        language?: string;
        datatype?: { value: string };
      };
      return `3:${term.value}${lit.datatype?.value ?? ''}${lit.language ?? ''}`;
    }
    default:
      return `9:${term.value}`;
  }
}

function bestPrefixFor(
  term: Term,
  entries: ReadonlyArray<[string, string]>,
): string | undefined {
  if (term.termType !== 'NamedNode') return undefined;
  const iri = term.value;
  let bestName: string | undefined;
  let bestLength = -1;
  for (const [name, prefIri] of entries) {
    if (iri.startsWith(prefIri) && prefIri.length > bestLength) {
      bestName = name;
      bestLength = prefIri.length;
    }
  }
  return bestName;
}
