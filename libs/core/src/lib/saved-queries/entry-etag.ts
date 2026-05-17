import { createHash } from 'node:crypto';
import type { SavedQueryEntry } from './saved-query-entry';

/**
 * Saved-query ETag (ADR-0036): `sha256(serialized-entry).slice(0, 16)`. The
 * canonicalization collapses internal whitespace runs in the body and trims
 * the body's edges so two formatting variants of the same SPARQL produce the
 * same ETag — otherwise hand-edits that reflow whitespace would surface as
 * `412` conflicts on every write.
 */
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
