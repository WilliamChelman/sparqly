import { buildSourceTree } from './source-search';
import type { SourceListingEntry } from '@app/core';

const EMPTY = new Set<string>();

describe('buildSourceTree', () => {
  it('renders every flat top-level entry when the query is empty', () => {
    const sources: SourceListingEntry[] = [
      { id: 'left', kind: 'glob', label: 'left' },
      { id: 'right', kind: 'glob', label: 'right' },
    ];

    const result = buildSourceTree(sources, '', EMPTY);

    expect(result.empty).toBe(false);
    expect(result.rows.map((r) => r.entry.id)).toEqual(['left', 'right']);
    expect(result.rows.every((r) => r.kind === 'leaf')).toBe(true);
    expect(result.matchCount).toBe(0);
  });

  it('reports empty=true with no rows when nothing matches', () => {
    const sources: SourceListingEntry[] = [
      { id: 'left', kind: 'glob', label: 'left' },
      { id: 'right', kind: 'glob', label: 'right' },
    ];

    const result = buildSourceTree(sources, 'zzzz', EMPTY);

    expect(result.empty).toBe(true);
    expect(result.rows).toEqual([]);
    expect(result.matchCount).toBe(0);
  });

  it('collapses a group by default and shows its total child count', () => {
    const sources: SourceListingEntry[] = [
      { id: 'docs', kind: 'glob', label: 'docs' },
      { id: 'docs/a.ttl', kind: 'file', label: 'docs/a.ttl', parentId: 'docs' },
      { id: 'docs/b.ttl', kind: 'file', label: 'docs/b.ttl', parentId: 'docs' },
    ];

    const result = buildSourceTree(sources, '', EMPTY);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].kind).toBe('group');
    const group = result.rows[0];
    if (group.kind !== 'group') throw new Error('expected group');
    expect(group.entry.id).toBe('docs');
    expect(group.childCount).toBe(2);
    expect(group.expanded).toBe(false);
    expect(group.selectable).toBe(true);
  });

  it('renders children indented (depth 1) with parent prefix stripped when group is expanded', () => {
    const sources: SourceListingEntry[] = [
      { id: 'docs', kind: 'glob', label: 'docs' },
      { id: 'docs/a.ttl', kind: 'file', label: 'docs/a.ttl', parentId: 'docs' },
      { id: 'docs/b.ttl', kind: 'file', label: 'docs/b.ttl', parentId: 'docs' },
    ];

    const result = buildSourceTree(sources, '', new Set(['docs']));

    expect(result.rows.map((r) => r.entry.id)).toEqual([
      'docs',
      'docs/a.ttl',
      'docs/b.ttl',
    ]);
    const a = result.rows[1];
    if (a.kind !== 'leaf') throw new Error('expected leaf');
    expect(a.depth).toBe(1);
    expect(a.displayLabel).toBe('a.ttl');
    const b = result.rows[2];
    if (b.kind !== 'leaf') throw new Error('expected leaf');
    expect(b.displayLabel).toBe('b.ttl');
  });

  it('hides non-matching siblings entirely (no dimming) and auto-expands the parent', () => {
    const sources: SourceListingEntry[] = [
      { id: 'docs', kind: 'glob', label: 'docs' },
      {
        id: 'docs/alice.ttl',
        kind: 'file',
        label: 'docs/alice.ttl',
        parentId: 'docs',
      },
      { id: 'docs/bob.ttl', kind: 'file', label: 'docs/bob.ttl', parentId: 'docs' },
    ];

    const result = buildSourceTree(sources, 'alice', EMPTY);

    expect(result.rows.map((r) => r.entry.id)).toEqual([
      'docs',
      'docs/alice.ttl',
    ]);
    const group = result.rows[0];
    if (group.kind !== 'group') throw new Error('expected group');
    expect(group.expanded).toBe(true);
    expect(group.selectable).toBe(false);
    expect(group.matchedChildCount).toBe(1);
    expect(result.matchCount).toBe(1);
  });

  it('keeps the parent breadcrumb selectable when the parent itself matches', () => {
    const sources: SourceListingEntry[] = [
      { id: 'era-skos', kind: 'glob', label: 'era-skos' },
      {
        id: 'era-skos/concept.ttl',
        kind: 'file',
        label: 'era-skos/concept.ttl',
        parentId: 'era-skos',
      },
    ];

    const result = buildSourceTree(sources, 'era', EMPTY);

    const group = result.rows[0];
    if (group.kind !== 'group') throw new Error('expected group');
    expect(group.selectable).toBe(true);
    expect(group.match).toEqual({ start: 0, end: 3 });
  });

  it('reports matchCount that includes matched parents and matched children', () => {
    const sources: SourceListingEntry[] = [
      { id: 'docs', kind: 'glob', label: 'docs' },
      { id: 'docs/a.ttl', kind: 'file', label: 'docs/a.ttl', parentId: 'docs' },
      { id: 'docs/b.ttl', kind: 'file', label: 'docs/b.ttl', parentId: 'docs' },
      { id: 'docs/c.ttl', kind: 'file', label: 'docs/c.ttl', parentId: 'docs' },
    ];

    const result = buildSourceTree(sources, '.ttl', EMPTY);

    // 3 matched children, parent itself doesn't match.
    expect(result.matchCount).toBe(3);
  });

  it('highlights the matched substring within the displayLabel (prefix-stripped for children)', () => {
    const sources: SourceListingEntry[] = [
      { id: 'docs', kind: 'glob', label: 'docs' },
      {
        id: 'docs/alice.ttl',
        kind: 'file',
        label: 'docs/alice.ttl',
        parentId: 'docs',
      },
    ];

    const result = buildSourceTree(sources, 'alice', EMPTY);
    const child = result.rows[1];
    if (child.kind !== 'leaf') throw new Error('expected leaf');
    expect(child.displayLabel).toBe('alice.ttl');
    expect(child.match).toEqual({ start: 0, end: 5 });
  });

  it('matches case-insensitively', () => {
    const sources: SourceListingEntry[] = [
      { id: 'left', kind: 'glob', label: 'left' },
      { id: 'right', kind: 'glob', label: 'right' },
    ];

    const result = buildSourceTree(sources, 'RIG', EMPTY);

    expect(result.rows.map((r) => r.entry.id)).toEqual(['right']);
    const hit = result.rows[0];
    if (hit.kind !== 'leaf') throw new Error('expected leaf');
    expect(hit.match).toEqual({ start: 0, end: 3 });
  });

  it('honors user-expanded groups during search only if the group itself matches', () => {
    const sources: SourceListingEntry[] = [
      { id: 'docs', kind: 'glob', label: 'docs' },
      { id: 'docs/a.ttl', kind: 'file', label: 'docs/a.ttl', parentId: 'docs' },
      { id: 'docs/b.ttl', kind: 'file', label: 'docs/b.ttl', parentId: 'docs' },
    ];

    // Query matches the group itself; user has it expanded → show all children.
    const result = buildSourceTree(sources, 'docs', new Set(['docs']));

    expect(result.rows.map((r) => r.entry.id)).toEqual([
      'docs',
      'docs/a.ttl',
      'docs/b.ttl',
    ]);
  });
});
