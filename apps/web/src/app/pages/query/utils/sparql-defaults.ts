import type { DisplayContext } from '@app/core';

export type QuickQueryKind =
  | 'select-spo'
  | 'select-spog'
  | 'construct-spo'
  | 'clear';

const BODIES: Record<Exclude<QuickQueryKind, 'clear'>, string> = {
  'select-spo': 'SELECT ?s ?p ?o WHERE {\n  ?s ?p ?o .\n} LIMIT 10',
  'select-spog':
    'SELECT ?s ?p ?o ?g WHERE {\n  GRAPH ?g { ?s ?p ?o . }\n} LIMIT 10',
  'construct-spo':
    'CONSTRUCT { ?s ?p ?o } WHERE {\n  ?s ?p ?o .\n} LIMIT 10',
};

export function acceptForQueryType(
  queryType: string | undefined,
): string | undefined {
  switch (queryType) {
    case 'SELECT':
    case 'ASK':
      return 'application/sparql-results+json';
    case 'CONSTRUCT':
    case 'DESCRIBE':
      return 'text/turtle';
    default:
      return undefined;
  }
}

export function buildQuickQuery(
  kind: QuickQueryKind,
  context: DisplayContext,
): string {
  if (kind === 'clear') return '';
  return buildHeader(context) + BODIES[kind];
}

export function buildDefaultQuery(context: DisplayContext): string {
  return buildQuickQuery('select-spo', context);
}

function buildHeader(context: DisplayContext): string {
  const lines: string[] = [];
  if (context.base) lines.push(`BASE <${context.base}>`);
  for (const [prefix, iri] of Object.entries(context.prefixes)) {
    lines.push(`PREFIX ${prefix}: <${iri}>`);
  }
  if (lines.length === 0) return '';
  return lines.join('\n') + '\n\n';
}
