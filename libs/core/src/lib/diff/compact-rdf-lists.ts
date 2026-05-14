import { DataFactory, Parser, type Quad, type Store, type Term } from 'n3';
import type { Hunk, HunkLine } from './group-rdf-diff-by-entity';
import { serializeObject } from './subject-path';

const RDF_FIRST_IRI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
const RDF_REST_IRI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest';
const RDF_NIL_IRI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil';

export interface SideMaps {
  store: Store;
  forward: Map<string, string> | undefined;
  inverse: Map<string, string> | undefined;
}

export function compactRdfListsInHunk(
  hunk: Hunk,
  left: SideMaps,
  right: SideMaps,
): void {
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
