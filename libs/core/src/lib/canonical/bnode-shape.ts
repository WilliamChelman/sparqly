import { createHash } from 'node:crypto';
import { Parser, type Quad, type Term } from 'n3';

/**
 * RDFC-1.0 assigns canonical blank-node labels that are stable within a
 * single dataset but can drift across two datasets whose overall bnode
 * topology differs — even when an individual bnode's local subgraph is
 * structurally identical on both sides. A pure string-diff over canonical
 * N-Quads then reports those isomorphic subtrees as added/removed.
 *
 * `computeBnodeShapeMap` derives a side-local "shape hash" per bnode by
 * iterative refinement over the canonical N-Quads' bnode topology: each
 * round, a bnode's hash is SHA-256 of its sorted outgoing-edge
 * `(predicate, object-sig, graph-sig)` tuples concatenated with its sorted
 * incoming-edge `(subject-sig, predicate, graph-sig)` tuples, where
 * bnode-typed subject/object positions are represented by the previous
 * round's hash. The fixpoint is reached in `O(depth)` rounds for trees;
 * cyclic bnode topologies converge to a stable bidirectional bisimulation
 * hash.
 *
 * Including incoming edges is essential: two bnodes with identical
 * outgoing subtrees but different parent contexts (e.g. an
 * `owl:unionOf ( … )` list reached from one property vs the same-shaped
 * list reached from another) would otherwise share a shape bucket and
 * mis-pair across sides, surfacing phantom bnode-rooted diffs.
 */
export function computeBnodeShapeMap(
  canonicalText: string,
): Map<string, string> {
  if (canonicalText.length === 0) return new Map();
  const parser = new Parser({
    format: 'application/n-quads',
    blankNodePrefix: '',
  });
  const quads = parser.parse(canonicalText);
  return computeBnodeShapeMapFromQuads(quads);
}

function computeBnodeShapeMapFromQuads(
  quads: ReadonlyArray<Quad>,
): Map<string, string> {
  const allBnodes = new Set<string>();
  const outgoing = new Map<
    string,
    Array<{ predicate: string; object: Term; graph: Term }>
  >();
  const incoming = new Map<
    string,
    Array<{ subject: Term; predicate: string; graph: Term }>
  >();
  for (const q of quads) {
    if (q.subject.termType === 'BlankNode') {
      allBnodes.add(q.subject.value);
      const list = outgoing.get(q.subject.value) ?? [];
      list.push({
        predicate: q.predicate.value,
        object: q.object,
        graph: q.graph,
      });
      outgoing.set(q.subject.value, list);
    }
    if (q.object.termType === 'BlankNode') {
      allBnodes.add(q.object.value);
      const inList = incoming.get(q.object.value) ?? [];
      inList.push({
        subject: q.subject,
        predicate: q.predicate.value,
        graph: q.graph,
      });
      incoming.set(q.object.value, inList);
    }
    if (q.graph.termType === 'BlankNode') allBnodes.add(q.graph.value);
  }
  for (const b of allBnodes) {
    if (!outgoing.has(b)) outgoing.set(b, []);
    if (!incoming.has(b)) incoming.set(b, []);
  }

  let hashes = new Map<string, string>();
  for (const b of allBnodes) hashes.set(b, '0');

  // Iterative refinement to a fixpoint. The bound is generous; depth = number
  // of edges in the longest acyclic bnode chain (RDF data we care about is
  // shallow). Cycles converge once each member's hash incorporates the cycle
  // signature of all other members.
  const MAX_ROUNDS = 64;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const next = new Map<string, string>();
    for (const b of allBnodes) {
      const outSigs: string[] = [];
      for (const e of outgoing.get(b) ?? []) {
        const objSig = termSignature(e.object, hashes);
        const graphSig = termSignature(e.graph, hashes);
        outSigs.push(`>|${e.predicate}|${objSig}|${graphSig}`);
      }
      outSigs.sort();
      const inSigs: string[] = [];
      for (const e of incoming.get(b) ?? []) {
        const subjSig = termSignature(e.subject, hashes);
        const graphSig = termSignature(e.graph, hashes);
        inSigs.push(`<|${subjSig}|${e.predicate}|${graphSig}`);
      }
      inSigs.sort();
      next.set(
        b,
        sha256(outSigs.join('\n') + '\n--\n' + inSigs.join('\n')),
      );
    }
    let stable = true;
    for (const b of allBnodes) {
      if (next.get(b) !== hashes.get(b)) {
        stable = false;
        break;
      }
    }
    hashes = next;
    if (stable) break;
  }
  return hashes;
}

function termSignature(term: Term, hashes: Map<string, string>): string {
  if (term.termType === 'BlankNode') {
    return `_:${hashes.get(term.value) ?? '0'}`;
  }
  if (term.termType === 'NamedNode') return `<${term.value}>`;
  if (term.termType === 'DefaultGraph') return '';
  // Literal
  const lit = term as Term & {
    language?: string;
    datatype?: { value: string };
  };
  const lex = JSON.stringify(term.value);
  if (lit.language && lit.language.length > 0) {
    return `${lex}@${lit.language}`;
  }
  if (
    lit.datatype &&
    lit.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string'
  ) {
    return `${lex}^^<${lit.datatype.value}>`;
  }
  return lex;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Re-serialize a canonical N-Quad with every blank-node label replaced by
 * the bnode's shape hash from {@link computeBnodeShapeMap}. The output is
 * intended for multiset pairing across sides — two canonical N-Quads with
 * the same shape-normalized form refer to the same triple modulo bnode
 * isomorphism.
 *
 * Unknown bnode labels fall back to their raw label, so a stale shape map
 * still produces a stable (if non-paired) key.
 */
export function shapeNormalizeCanonicalNQuad(
  canonicalNQuad: string,
  shapeMap: Map<string, string>,
): string {
  const parser = new Parser({
    format: 'application/n-quads',
    blankNodePrefix: '',
  });
  const quads = parser.parse(canonicalNQuad);
  if (quads.length !== 1) return canonicalNQuad;
  const q = quads[0];
  const s = serializeWithShape(q.subject, shapeMap);
  const p = serializeWithShape(q.predicate, shapeMap);
  const o = serializeWithShape(q.object, shapeMap);
  if (q.graph.termType === 'DefaultGraph') return `${s} ${p} ${o} .`;
  const g = serializeWithShape(q.graph, shapeMap);
  return `${s} ${p} ${o} ${g} .`;
}

function serializeWithShape(
  term: Term,
  shapeMap: Map<string, string>,
): string {
  if (term.termType === 'BlankNode') {
    const hash = shapeMap.get(term.value);
    return hash !== undefined ? `_:shape:${hash}` : `_:${term.value}`;
  }
  if (term.termType === 'NamedNode') return `<${term.value}>`;
  if (term.termType === 'Literal') {
    const lit = term as Term & {
      language?: string;
      datatype?: { value: string };
    };
    const lex = `"${escapeLiteral(term.value)}"`;
    if (lit.language && lit.language.length > 0) {
      return `${lex}@${lit.language}`;
    }
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
