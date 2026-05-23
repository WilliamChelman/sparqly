import { createHash } from 'node:crypto';
import type { SavedQueryEntry } from './saved-query-entry';

// `sha256(serialized-entry).slice(0, 16)`. Body whitespace is collapsed and
// edges trimmed so reformatted SPARQL doesn't surface as 412 conflicts.
export function deriveEntryEtag(entry: SavedQueryEntry): string {
  const canonical = JSON.stringify({
    slug: entry.slug,
    description: entry.description ?? null,
    body: canonicalizeBody(entry.body),
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

function canonicalizeBody(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}
