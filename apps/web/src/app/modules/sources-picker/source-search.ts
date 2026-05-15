import type { SourceListingEntry } from '@app/core';

export interface SourceSearchMatch {
  readonly field: 'id' | 'label';
  readonly start: number;
  readonly end: number;
}

export interface SourceSearchHit {
  readonly entry: SourceListingEntry;
  readonly matched: boolean;
  readonly dimmed: boolean;
  readonly expanded: boolean;
  readonly match?: SourceSearchMatch;
}

export interface SourceSearchResult {
  readonly hits: ReadonlyArray<SourceSearchHit>;
  readonly empty: boolean;
}

function findMatch(
  entry: SourceListingEntry,
  needle: string,
): SourceSearchMatch | undefined {
  const idIdx = entry.id.toLowerCase().indexOf(needle);
  if (idIdx !== -1) {
    return { field: 'id', start: idIdx, end: idIdx + needle.length };
  }
  const labelIdx = entry.label.toLowerCase().indexOf(needle);
  if (labelIdx !== -1) {
    return { field: 'label', start: labelIdx, end: labelIdx + needle.length };
  }
  return undefined;
}

export function searchSources(
  sources: ReadonlyArray<SourceListingEntry>,
  query: string,
): SourceSearchResult {
  if (query === '') {
    return {
      empty: false,
      hits: sources.map((entry) => ({
        entry,
        matched: true,
        dimmed: false,
        expanded: false,
      })),
    };
  }

  const needle = query.toLowerCase();
  const directMatch = new Map<string, SourceSearchMatch>();
  for (const entry of sources) {
    const m = findMatch(entry, needle);
    if (m !== undefined) directMatch.set(entry.id, m);
  }

  if (directMatch.size === 0) {
    return { hits: [], empty: true };
  }

  const parentsWithMatchingChild = new Set<string>();
  for (const entry of sources) {
    if (!directMatch.has(entry.id)) continue;
    if (entry.parentId !== undefined) {
      parentsWithMatchingChild.add(entry.parentId);
    }
  }

  const hits: SourceSearchHit[] = [];
  for (const entry of sources) {
    const match = directMatch.get(entry.id);
    if (match !== undefined) {
      hits.push({
        entry,
        matched: true,
        dimmed: false,
        expanded: parentsWithMatchingChild.has(entry.id),
        match,
      });
      continue;
    }
    if (parentsWithMatchingChild.has(entry.id)) {
      hits.push({
        entry,
        matched: false,
        dimmed: false,
        expanded: true,
      });
      continue;
    }
    if (
      entry.parentId !== undefined &&
      parentsWithMatchingChild.has(entry.parentId)
    ) {
      hits.push({
        entry,
        matched: false,
        dimmed: true,
        expanded: false,
      });
    }
  }

  return { hits, empty: hits.length === 0 };
}
