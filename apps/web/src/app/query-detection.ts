export type QueryType = 'SELECT' | 'CONSTRUCT' | 'ASK' | 'DESCRIBE';

const QUERY_FORMS: ReadonlySet<QueryType> = new Set([
  'SELECT',
  'CONSTRUCT',
  'ASK',
  'DESCRIBE',
]);

const PROLOGUE_LINE = /^\s*(?:#[^\n]*|PREFIX\s+\S+\s*:\s*<[^>]*>\s*|BASE\s+<[^>]*>\s*)$/i;

export function detectQueryType(value: string): QueryType | undefined {
  const lines = value.split('\n');
  for (const line of lines) {
    if (line.trim() === '' || PROLOGUE_LINE.test(line)) continue;
    const m = /^\s*([A-Za-z]+)/.exec(line);
    if (!m) return undefined;
    const word = m[1].toUpperCase() as QueryType;
    return QUERY_FORMS.has(word) ? word : undefined;
  }
  return undefined;
}

export function countPrefixes(value: string): number {
  const stripped = value.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  const seen = new Set<string>();
  const re = /^[ \t]*PREFIX\s+([A-Za-z_][\w-]*)\s*:\s*<[^>]*>/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    seen.add(m[1]);
  }
  return seen.size;
}
