import { searchSources } from './source-search';
import type { SourceListingEntry } from '@app/core';

describe('searchSources', () => {
  it('returns every entry as matched and undimmed when the query is empty', () => {
    const sources: SourceListingEntry[] = [
      { id: 'left', kind: 'glob', label: 'left (glob)' },
      { id: 'right', kind: 'glob', label: 'right (glob)' },
    ];

    const result = searchSources(sources, '');

    expect(result.empty).toBe(false);
    expect(result.hits.map((h) => h.entry.id)).toEqual(['left', 'right']);
    expect(result.hits.every((h) => h.matched && !h.dimmed)).toBe(true);
    expect(result.hits.every((h) => h.match === undefined)).toBe(true);
  });

  it('reports empty=true with no hits when nothing matches', () => {
    const sources: SourceListingEntry[] = [
      { id: 'left', kind: 'glob', label: 'left (glob)' },
      { id: 'right', kind: 'glob', label: 'right (glob)' },
    ];

    const result = searchSources(sources, 'zzzz');

    expect(result.empty).toBe(true);
    expect(result.hits).toEqual([]);
  });

  it('auto-expands the parent group when a child matches and dims non-matching siblings', () => {
    const sources: SourceListingEntry[] = [
      { id: 'docs', kind: 'glob', label: 'docs (glob)' },
      {
        id: 'docs/alice.ttl',
        kind: 'file',
        label: 'alice.ttl',
        parentId: 'docs',
      },
      {
        id: 'docs/bob.ttl',
        kind: 'file',
        label: 'bob.ttl',
        parentId: 'docs',
      },
    ];

    const result = searchSources(sources, 'alice');

    const byId = new Map(result.hits.map((h) => [h.entry.id, h]));
    expect(byId.get('docs')?.expanded).toBe(true);
    expect(byId.get('docs')?.matched).toBe(false);
    expect(byId.get('docs')?.dimmed).toBe(false);
    expect(byId.get('docs/alice.ttl')?.matched).toBe(true);
    expect(byId.get('docs/alice.ttl')?.dimmed).toBe(false);
    expect(byId.get('docs/bob.ttl')?.matched).toBe(false);
    expect(byId.get('docs/bob.ttl')?.dimmed).toBe(true);
    expect(result.empty).toBe(false);
  });

  it('matches a substring that spans path separators in the id', () => {
    const sources: SourceListingEntry[] = [
      { id: 'docs', kind: 'glob', label: 'docs (glob)' },
      {
        id: 'docs/people/alice.ttl',
        kind: 'file',
        label: 'alice.ttl',
        parentId: 'docs',
      },
      {
        id: 'docs/people/bob.ttl',
        kind: 'file',
        label: 'bob.ttl',
        parentId: 'docs',
      },
    ];

    const result = searchSources(sources, 'people/alice');

    const matchedIds = result.hits
      .filter((h) => h.matched)
      .map((h) => h.entry.id);
    expect(matchedIds).toEqual(['docs/people/alice.ttl']);
  });

  it('matches case-insensitive substring on entry id and returns the match position', () => {
    const sources: SourceListingEntry[] = [
      { id: 'left', kind: 'glob', label: 'left (glob)' },
      { id: 'right', kind: 'glob', label: 'right (glob)' },
    ];

    const result = searchSources(sources, 'RIG');

    expect(result.empty).toBe(false);
    const matchedHits = result.hits.filter((h) => h.matched);
    expect(matchedHits.map((h) => h.entry.id)).toEqual(['right']);
    expect(matchedHits[0].match).toEqual({ field: 'id', start: 0, end: 3 });
  });
});
