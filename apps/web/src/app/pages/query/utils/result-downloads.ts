import type {
  AskResult,
  SelectResult,
  Term,
  Triple,
  TripleResult,
} from '@app/core';
import { exportBindingsCsv } from './csv-exporter';
import type { FormattedResult } from './result-to-formatted';

/** A single downloadable serialization offered on the result pane's download tab. */
export interface DownloadOption {
  id: string;
  label: string;
  filename: string;
  mediaType: string;
  body: string;
}

export function selectDownloads(r: SelectResult): DownloadOption[] {
  const csv = exportBindingsCsv(r.variables, r.bindings);
  const tsv = exportBindingsCsv(r.variables, r.bindings, { delimiter: '\t' });
  const json =
    r.contentType === 'application/sparql-results+json'
      ? r.raw
      : reserializeSelectAsJson(r);
  return [
    {
      id: 'csv',
      label: 'CSV',
      filename: 'result.csv',
      mediaType: 'text/csv',
      body: csv,
    },
    {
      id: 'tsv',
      label: 'TSV',
      filename: 'result.tsv',
      mediaType: 'text/tab-separated-values',
      body: tsv,
    },
    {
      id: 'json',
      label: 'JSON',
      filename: 'result.json',
      mediaType: 'application/sparql-results+json',
      body: json,
    },
  ];
}

export function askDownloads(r: AskResult): DownloadOption[] {
  const json =
    r.contentType === 'application/sparql-results+json'
      ? r.raw
      : JSON.stringify({ head: {}, boolean: r.value });
  return [
    {
      id: 'json',
      label: 'JSON',
      filename: 'result.json',
      mediaType: 'application/sparql-results+json',
      body: json,
    },
  ];
}

export function tripleDownloads(
  r: TripleResult,
  formatted: FormattedResult | null,
): DownloadOption[] {
  const nquads =
    r.contentType === 'application/n-quads'
      ? r.raw
      : serializeNquads(r.triples);
  return [
    formattedDownload(formatted),
    {
      id: 'nquads',
      label: 'N-Quads',
      filename: 'result.nq',
      mediaType: 'application/n-quads',
      body: nquads,
    },
  ];
}

export function formattedDownload(
  formatted: FormattedResult | null,
): DownloadOption {
  const isTrig = formatted?.serialization === 'trig';
  return {
    id: 'turtle',
    label: isTrig ? 'TriG' : 'Turtle',
    filename: isTrig ? 'result.trig' : 'result.ttl',
    mediaType: isTrig ? 'application/trig' : 'text/turtle',
    body: formatted?.body ?? '',
  };
}

function reserializeSelectAsJson(r: SelectResult): string {
  const bindings = r.bindings.map((row) => {
    const out: Record<string, { type: string; value: string; datatype?: string; 'xml:lang'?: string }> = {};
    for (const [name, term] of Object.entries(row)) {
      out[name] = sparqlJsonTerm(term);
    }
    return out;
  });
  return JSON.stringify({
    head: { vars: r.variables },
    results: { bindings },
  });
}

function sparqlJsonTerm(t: Term): { type: string; value: string; datatype?: string; 'xml:lang'?: string } {
  if (t.termType === 'NamedNode') return { type: 'uri', value: t.value };
  if (t.termType === 'BlankNode') return { type: 'bnode', value: t.value };
  const out: { type: string; value: string; datatype?: string; 'xml:lang'?: string } = {
    type: 'literal',
    value: t.value,
  };
  if (t.language) out['xml:lang'] = t.language;
  if (t.datatype?.value) out.datatype = t.datatype.value;
  return out;
}

function serializeNquads(triples: ReadonlyArray<Triple>): string {
  return triples
    .map((t) => {
      const parts = [
        nquadTerm(t.subject),
        nquadTerm(t.predicate),
        nquadTerm(t.object),
      ];
      if (t.graph) parts.push(nquadTerm(t.graph));
      return `${parts.join(' ')} .`;
    })
    .join('\n')
    .concat(triples.length > 0 ? '\n' : '');
}

function nquadTerm(t: Term): string {
  if (t.termType === 'NamedNode') return `<${t.value}>`;
  if (t.termType === 'BlankNode') return `_:${t.value}`;
  const lex = `"${t.value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
  if (t.language) return `${lex}@${t.language}`;
  if (t.datatype?.value && t.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string') {
    return `${lex}^^<${t.datatype.value}>`;
  }
  return lex;
}
