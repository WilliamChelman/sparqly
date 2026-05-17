import type { DisplayContext } from '@app/core';

const DEFAULT_BODY = 'SELECT ?s ?p ?o WHERE {\n  ?s ?p ?o .\n} LIMIT 10';

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

export function buildDefaultQuery(context: DisplayContext): string {
  const lines: string[] = [];
  if (context.base) lines.push(`BASE <${context.base}>`);
  for (const [prefix, iri] of Object.entries(context.prefixes)) {
    lines.push(`PREFIX ${prefix}: <${iri}>`);
  }
  if (lines.length > 0) lines.push('');
  return lines.join('\n') + '\n' + DEFAULT_BODY;
}
