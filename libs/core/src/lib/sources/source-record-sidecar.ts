import type { Quad, Term } from 'n3';

/**
 * Per-quad provenance for an asserted triple loaded from a glob or file
 * source (ADR-0032). Records `file` as an absolute `file://` IRI of the
 * working-tree path (even when content was fetched from a git tree), and
 * carries `line` / `endLine` when the parser surfaced them and `gitRef` /
 * `gitSha` when the load was pinned.
 */
export interface SourceRecord {
  file: string;
  line?: number;
  endLine?: number;
  gitRef?: string;
  gitSha?: string;
}

/**
 * Loader-attached source-record sidecar (ADR-0032). Maps a graph-agnostic
 * triple-pattern key (the asserted s/p/o serialized as N-Triples-style
 * `<s> <p> <o> .`, raw bnode labels) to the {@link SourceRecord}s for that
 * triple. One sidecar per materialized glob/file load; carried alongside the
 * Store through `resolveSourceResult` and into `engine-map`. Re-keyed by
 * canonical N-Quads — and fanned out across graphs — at diff time.
 */
export type SourceRecordSidecar = ReadonlyMap<string, ReadonlyArray<SourceRecord>>;

/**
 * Build the graph-agnostic key (`<s> <p> <o> .`) the sidecar uses to bucket
 * records for an asserted quad. Raw bnode labels — the sidecar is built
 * before canonicalization; the diff re-keys via the canonicalizer's id map.
 */
export function triplePatternKey(s: Term, p: Term, o: Term): string {
  return `${serializeTerm(s)} ${serializeTerm(p)} ${serializeTerm(o)} .`;
}

export interface SidecarLoaderRecord {
  quad: Quad;
  line?: number;
  endLine?: number;
}

/**
 * Build a {@link SourceRecordSidecar} from the loader's per-file records.
 * Each record produces one {@link SourceRecord} keyed by its asserted
 * triple's s/p/o (graph-agnostic). When `pin` is supplied (a pinned-source
 * load — ADR-0029), every emitted record carries `gitRef` / `gitSha`
 * directly from the pin context — no RDF-star round-trip.
 */
export function buildSourceRecordSidecar(
  perFileRecords: ReadonlyMap<string, ReadonlyArray<SidecarLoaderRecord>>,
  pin?: { ref: string; sha: string },
): SourceRecordSidecar {
  const out = new Map<string, SourceRecord[]>();
  for (const [file, records] of perFileRecords) {
    const fileIri = toFileIri(file);
    for (const rec of records) {
      const key = triplePatternKey(
        rec.quad.subject,
        rec.quad.predicate,
        rec.quad.object,
      );
      const entry: SourceRecord = { file: fileIri };
      if (rec.line !== undefined) entry.line = rec.line;
      if (rec.endLine !== undefined) entry.endLine = rec.endLine;
      if (pin !== undefined) {
        entry.gitRef = pin.ref;
        entry.gitSha = pin.sha;
      }
      const bucket = out.get(key);
      if (bucket === undefined) out.set(key, [entry]);
      else bucket.push(entry);
    }
  }
  return out;
}

function toFileIri(absPath: string): string {
  return absPath.startsWith('/') ? `file://${absPath}` : `file:///${absPath}`;
}

function serializeTerm(term: Term): string {
  if (term.termType === 'NamedNode') return `<${term.value}>`;
  if (term.termType === 'BlankNode') return `_:${term.value}`;
  if (term.termType === 'Literal') {
    const lit = term as Term & {
      language?: string;
      datatype?: { value: string };
    };
    const lex = `"${escapeLiteral(term.value)}"`;
    if (lit.language && lit.language.length > 0) return `${lex}@${lit.language}`;
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
