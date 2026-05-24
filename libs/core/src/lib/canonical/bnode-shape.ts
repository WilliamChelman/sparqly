import { createHash } from 'node:crypto';
import { Parser, type Quad, type Term } from 'n3';

/**
 * Side-local bisimulation shape hash per bnode, used for cross-side pairing
 * since RDFC-1.0 labels can drift across datasets with different overall
 * topology. Incoming edges are included so bnodes with identical outgoing
 * subtrees but different parent contexts don't mis-pair.
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
 * Serialize an N-Quad with bnode labels replaced by their shape hashes for
 * cross-side multiset pairing. Unknown labels fall back to their raw form.
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
