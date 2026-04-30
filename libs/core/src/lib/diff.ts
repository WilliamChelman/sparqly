import { Parser, type Term } from 'n3';

export type RdfDiffFormat = 'human' | 'json' | 'rdf-patch';

export interface RdfDiffResult {
  /** Canonical N-Quads strings present on the right but not the left, sorted lexicographically. */
  added: string[];
  /** Canonical N-Quads strings present on the left but not the right, sorted lexicographically. */
  removed: string[];
}

export interface RdfStatementJson {
  s: RdfTermJson;
  p: RdfTermJson;
  o: RdfTermJson;
  g?: RdfTermJson;
}

export interface RdfTermJson {
  termType: string;
  value: string;
  datatype?: string;
  language?: string;
}

export function diffCanonicalStatements(
  left: readonly string[],
  right: readonly string[],
): RdfDiffResult {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const removed = left.filter((s) => !rightSet.has(s)).sort();
  const added = right.filter((s) => !leftSet.has(s)).sort();
  return { added, removed };
}

export function formatRdfDiff(
  diff: RdfDiffResult,
  format: RdfDiffFormat,
): string {
  if (format === 'json') {
    const json = {
      added: diff.added.map(parseStatement),
      removed: diff.removed.map(parseStatement),
    };
    return `${JSON.stringify(json)}\n`;
  }
  if (format === 'rdf-patch') {
    const parts: string[] = [];
    for (const s of diff.removed) parts.push(`D ${s}\n`);
    for (const s of diff.added) parts.push(`A ${s}\n`);
    return parts.join('');
  }
  const parts: string[] = [];
  for (const s of diff.removed) parts.push(`- ${s}\n`);
  for (const s of diff.added) parts.push(`+ ${s}\n`);
  return parts.join('');
}

function parseStatement(line: string): RdfStatementJson {
  const parser = new Parser({ format: 'application/n-quads' });
  const quads = parser.parse(line);
  if (quads.length !== 1) {
    throw new Error(`expected exactly one quad, got ${quads.length}: ${line}`);
  }
  const q = quads[0];
  const out: RdfStatementJson = {
    s: termToJson(q.subject),
    p: termToJson(q.predicate),
    o: termToJson(q.object),
  };
  if (q.graph.termType !== 'DefaultGraph') {
    out.g = termToJson(q.graph);
  }
  return out;
}

function termToJson(term: Term): RdfTermJson {
  const out: RdfTermJson = { termType: term.termType, value: term.value };
  if (term.termType === 'Literal') {
    const lit = term as Term & {
      language?: string;
      datatype?: { value: string };
    };
    if (lit.language && lit.language.length > 0) out.language = lit.language;
    if (lit.datatype && lit.datatype.value) out.datatype = lit.datatype.value;
  }
  return out;
}
