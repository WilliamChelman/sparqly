import { DataFactory, type Quad, type Term } from 'n3';

const { namedNode, blankNode, literal, defaultGraph, quad: makeQuad } = DataFactory;

/**
 * Codec for the `/api/describe` wire format. Line-oriented N-Quads with
 * old-style RDF-star quoted-triple subjects (`<<s p o [g]>> <pred> obj [g]`).
 *
 * The n3.js library only emits RDF 1.2 triple-term syntax (`<<( ... )>>`) and
 * its parser reifies old-style `<<...>>` via `rdf:reifies`, so neither
 * direction round-trips our chosen wire shape. This codec handles it
 * explicitly so the server and the webapp renderer agree on the bytes.
 *
 * Supports: NamedNode, BlankNode, Literal (plain, lang-tagged, datatyped),
 * DefaultGraph and NamedNode graph, and one level of quoted-triple subjects.
 * Quoted-triple terms in object/predicate position are out of scope (the
 * describe wire never produces them).
 */

export function serializeDescribeWire(quads: ReadonlyArray<Quad>): string {
  if (quads.length === 0) return '';
  const lines: string[] = [];
  for (const q of quads) lines.push(`${encodeQuad(q)} .`);
  return lines.join('\n') + '\n';
}

export function parseDescribeWire(text: string): Quad[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  const out: Quad[] = [];
  const cursor = { text: trimmed, pos: 0 };
  while (cursor.pos < cursor.text.length) {
    skipWhitespace(cursor);
    if (cursor.pos >= cursor.text.length) break;
    out.push(readStatement(cursor));
  }
  return out;
}

function encodeQuad(q: Quad): string {
  const s = encodeTerm(q.subject);
  const p = encodeTerm(q.predicate);
  const o = encodeTerm(q.object);
  if (q.graph.termType === 'DefaultGraph') return `${s} ${p} ${o}`;
  return `${s} ${p} ${o} ${encodeTerm(q.graph)}`;
}

function encodeTerm(t: Term): string {
  if (t.termType === 'NamedNode') return `<${t.value}>`;
  if (t.termType === 'BlankNode') return `_:${t.value}`;
  if (t.termType === 'DefaultGraph') return '';
  if (t.termType === 'Literal') return encodeLiteral(t as import('n3').Literal);
  if ((t.termType as string) === 'Quad') {
    return `<<${encodeQuad(t as unknown as Quad)}>>`;
  }
  throw new Error(`describe-wire: unsupported term type ${t.termType}`);
}

function encodeLiteral(lit: import('n3').Literal): string {
  const value = escapeLiteral(lit.value);
  if (lit.language) return `"${value}"@${lit.language}`;
  const dt = lit.datatype.value;
  if (dt && dt !== 'http://www.w3.org/2001/XMLSchema#string') {
    return `"${value}"^^<${dt}>`;
  }
  return `"${value}"`;
}

function escapeLiteral(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

interface Cursor {
  text: string;
  pos: number;
}

function readStatement(c: Cursor): Quad {
  const subject = readTerm(c);
  skipWhitespace(c);
  const predicate = readTerm(c);
  skipWhitespace(c);
  const object = readTerm(c);
  skipWhitespace(c);
  let graph: Term = defaultGraph();
  if (c.text[c.pos] !== '.') {
    graph = readTerm(c);
    skipWhitespace(c);
  }
  if (c.text[c.pos] !== '.') {
    throw new Error(`describe-wire: expected '.' at offset ${c.pos}`);
  }
  c.pos++; // consume the dot
  return makeQuad(
    subject as Quad['subject'],
    predicate as Quad['predicate'],
    object as Quad['object'],
    graph as Quad['graph'],
  ) as Quad;
}

function readTerm(c: Cursor): Term {
  const head = c.text[c.pos];
  if (head === '<') {
    if (c.text.startsWith('<<', c.pos)) {
      return readQuotedTriple(c);
    }
    return readIri(c);
  }
  if (head === '_') return readBlankNode(c);
  if (head === '"') return readLiteral(c);
  throw new Error(`describe-wire: unexpected character '${head}' at offset ${c.pos}`);
}

function readQuotedTriple(c: Cursor): Term {
  c.pos += 2; // consume '<<'
  skipWhitespace(c);
  const inner = readStatementInsideQuoted(c);
  skipWhitespace(c);
  if (!c.text.startsWith('>>', c.pos)) {
    throw new Error(`describe-wire: expected '>>' at offset ${c.pos}`);
  }
  c.pos += 2;
  return inner as unknown as Term;
}

function readStatementInsideQuoted(c: Cursor): Quad {
  const subject = readTerm(c);
  skipWhitespace(c);
  const predicate = readTerm(c);
  skipWhitespace(c);
  const object = readTerm(c);
  skipWhitespace(c);
  let graph: Term = defaultGraph();
  if (!c.text.startsWith('>>', c.pos)) {
    graph = readTerm(c);
    skipWhitespace(c);
  }
  return makeQuad(
    subject as Quad['subject'],
    predicate as Quad['predicate'],
    object as Quad['object'],
    graph as Quad['graph'],
  ) as Quad;
}

function readIri(c: Cursor): Term {
  // Consume single '<'
  c.pos++;
  const start = c.pos;
  while (c.pos < c.text.length && c.text[c.pos] !== '>') c.pos++;
  const iri = c.text.slice(start, c.pos);
  if (c.text[c.pos] !== '>') {
    throw new Error(`describe-wire: unterminated IRI at offset ${start}`);
  }
  c.pos++; // consume '>'
  return namedNode(iri);
}

function readBlankNode(c: Cursor): Term {
  if (!c.text.startsWith('_:', c.pos)) {
    throw new Error(`describe-wire: expected '_:' at offset ${c.pos}`);
  }
  c.pos += 2;
  const start = c.pos;
  while (
    c.pos < c.text.length &&
    /[A-Za-z0-9_\-.]/.test(c.text[c.pos])
  ) {
    c.pos++;
  }
  return blankNode(c.text.slice(start, c.pos));
}

function readLiteral(c: Cursor): Term {
  c.pos++; // consume opening '"'
  let value = '';
  while (c.pos < c.text.length) {
    const ch = c.text[c.pos];
    if (ch === '\\') {
      const next = c.text[c.pos + 1];
      if (next === 'n') value += '\n';
      else if (next === 'r') value += '\r';
      else if (next === 't') value += '\t';
      else if (next === '"') value += '"';
      else if (next === '\\') value += '\\';
      else value += next;
      c.pos += 2;
      continue;
    }
    if (ch === '"') break;
    value += ch;
    c.pos++;
  }
  if (c.text[c.pos] !== '"') {
    throw new Error(`describe-wire: unterminated literal at offset ${c.pos}`);
  }
  c.pos++; // consume closing '"'
  if (c.text[c.pos] === '@') {
    c.pos++;
    const langStart = c.pos;
    while (
      c.pos < c.text.length &&
      /[A-Za-z0-9-]/.test(c.text[c.pos])
    ) {
      c.pos++;
    }
    const lang = c.text.slice(langStart, c.pos);
    return literal(value, lang);
  }
  if (c.text.startsWith('^^', c.pos)) {
    c.pos += 2;
    const dt = readIri(c);
    return literal(value, dt as import('n3').NamedNode);
  }
  return literal(value);
}

function skipWhitespace(c: Cursor): void {
  while (
    c.pos < c.text.length &&
    (c.text[c.pos] === ' ' ||
      c.text[c.pos] === '\t' ||
      c.text[c.pos] === '\n' ||
      c.text[c.pos] === '\r')
  ) {
    c.pos++;
  }
}
