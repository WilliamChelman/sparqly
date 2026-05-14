import { DataFactory, Writer, type Quad, type Term } from 'n3';
import { detectLists } from './detect-lists';
import { inlineSingleUseBlankNodes } from './inline-blank-nodes';
import { installMultilineLiteralEncoder } from './multiline-literal-encoder';
import { pickUsedPrefixes } from './pick-prefixes';
import { RDF_TYPE } from './shorten-nquad-line';

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

  const { lists, consumed, listGraphs } = detectLists(list);
  const remaining = list.filter((q) => !consumed.has(q));

  const writer = new Writer({
    format: SERIALIZATION_TO_FORMAT[serialization],
    prefixes: pickUsedPrefixes(remaining, config.prefixes),
    baseIRI: config.base,
    lists,
  } as ConstructorParameters<typeof Writer>[0] & {
    lists: Record<string, Term[]>;
  });
  installMultilineLiteralEncoder(writer);

  const inlined = inlineSingleUseBlankNodes(remaining, writer, lists, listGraphs);
  const anchorIris = resolveAnchorIris(
    config.objectAnchoredPredicates,
    config.prefixes,
  );
  const sorted = [...inlined].sort((a, b) => compareForEmission(a, b, anchorIris));
  let prevBlock: string | null = null;
  let prevGraphKey: string | null = null;
  let prevPrimaryKey: string | null = null;
  for (const q of sorted) {
    const gk = termKey(q.graph);
    const bk = blockKey(q, anchorIris);
    const pk = primaryKey(q, anchorIris);
    if (prevBlock !== null && prevGraphKey !== gk) {
      forceGraphBreak(writer);
    } else if (prevBlock !== null && prevBlock !== bk) {
      // The N3 Writer joins consecutive same-subject quads with `;`. When a
      // block boundary falls across two same-subject quads (a normal triple
      // followed by an object-anchored one with the same subject) we have to
      // force a paragraph break ourselves so the anchored line stands alone.
      forceSubjectBreak(writer);
      if (prevPrimaryKey !== pk) {
        writeRaw(writer, '\n');
      }
    }
    writer.addQuad(q);
    prevBlock = bk;
    prevGraphKey = gk;
    prevPrimaryKey = pk;
  }

  let body = '';
  writer.end((error, result) => {
    if (error) throw error;
    body = result;
  });
  return config.base ? `@base <${config.base}>.\n${body}` : body;
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

function primaryKey(q: Quad, anchorIris: Set<string>): string {
  return isAnchored(q, anchorIris) ? termKey(q.object) : termKey(q.subject);
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

function writeRaw(writer: Writer, s: string): void {
  (writer as unknown as { _write(s: string, done?: unknown): void })._write(s);
}

function forceGraphBreak(writer: Writer): void {
  const w = writer as unknown as {
    _subject: Term | null;
    _graph: Term;
    _inDefaultGraph: boolean;
    _write(s: string, done?: unknown): void;
  };
  if (w._subject !== null) {
    w._write(w._inDefaultGraph ? '.\n' : '\n}\n');
    w._subject = null;
    w._graph = DataFactory.defaultGraph();
  }
  w._write('\n');
}

function compareQuads(a: Quad, b: Quad): number {
  return (
    compareTerm(a.graph, b.graph) ||
    compareTerm(a.subject, b.subject) ||
    comparePredicate(a.predicate, b.predicate) ||
    compareTerm(a.object, b.object)
  );
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

export function comparePredicate(a: Term, b: Term): number {
  const aIsType = a.termType === 'NamedNode' && a.value === RDF_TYPE;
  const bIsType = b.termType === 'NamedNode' && b.value === RDF_TYPE;
  if (aIsType && !bIsType) return -1;
  if (!aIsType && bIsType) return 1;
  return compareTerm(a, b);
}

export function compareTerm(a: Term, b: Term): number {
  const aKey = termKey(a);
  const bKey = termKey(b);
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}

export function termKey(term: Term): string {
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
      return `3:${term.value}${lit.datatype?.value ?? ''}${lit.language ?? ''}`;
    }
    default:
      return `9:${term.value}`;
  }
}
