const PREFIX_RE = /\bPREFIX\s+([^\s:]*):\s*<([^>]*)>/gi;

export function parseSparqlPrefixes(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of query.matchAll(PREFIX_RE)) {
    out[match[1]] = match[2];
  }
  return out;
}
