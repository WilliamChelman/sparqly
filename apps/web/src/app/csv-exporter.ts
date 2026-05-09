import type { Term } from './sparql-result-decoder';

export interface ExportBindingsCsvOptions {
  delimiter?: string;
}

export function exportBindingsCsv(
  variables: ReadonlyArray<string>,
  bindings: ReadonlyArray<Record<string, Term>>,
  options: ExportBindingsCsvOptions = {},
): string {
  const delim = options.delimiter ?? ',';
  const lines: string[] = [];
  lines.push(variables.map((v) => quoteCell(v, delim)).join(delim));
  for (const row of bindings) {
    const cells = variables.map((v) => {
      const term = row[v];
      if (term === undefined) return '';
      return quoteCell(termToCell(term), delim);
    });
    lines.push(cells.join(delim));
  }
  return lines.map((l) => `${l}\r\n`).join('');
}

function termToCell(term: Term): string {
  if (term.termType === 'NamedNode') return `<${term.value}>`;
  if (term.termType === 'BlankNode') return `_:${term.value}`;
  if (term.language) return `${term.value}@${term.language}`;
  const dt = term.datatype?.value;
  if (
    dt &&
    dt !== 'http://www.w3.org/2001/XMLSchema#string' &&
    dt !== 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'
  ) {
    return `${term.value}^^<${dt}>`;
  }
  return term.value;
}

function quoteCell(cell: string, delim: string): string {
  if (
    cell.includes(delim) ||
    cell.includes('"') ||
    cell.includes('\n') ||
    cell.includes('\r')
  ) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}
