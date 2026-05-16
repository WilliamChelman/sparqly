import type { SourceListingEntry } from '@app/core';

export interface SourceMatchSpan {
  readonly start: number;
  readonly end: number;
}

export interface SourceGroupRow {
  readonly kind: 'group';
  readonly entry: SourceListingEntry;
  readonly displayLabel: string;
  readonly childCount: number;
  readonly matchedChildCount: number;
  readonly expanded: boolean;
  readonly selectable: boolean;
  readonly match?: SourceMatchSpan;
}

export interface SourceLeafRow {
  readonly kind: 'leaf';
  readonly entry: SourceListingEntry;
  readonly depth: 0 | 1;
  readonly displayLabel: string;
  readonly match?: SourceMatchSpan;
}

export type SourceRow = SourceGroupRow | SourceLeafRow;

export interface SourceTreeResult {
  readonly rows: ReadonlyArray<SourceRow>;
  readonly matchCount: number;
  readonly totalCount: number;
  readonly empty: boolean;
}

function getMatchSpan(text: string, needle: string): SourceMatchSpan | undefined {
  if (needle === '') return undefined;
  const idx = text.toLowerCase().indexOf(needle);
  if (idx === -1) return undefined;
  return { start: idx, end: idx + needle.length };
}

function entryMatches(entry: SourceListingEntry, needle: string): boolean {
  return (
    entry.id.toLowerCase().includes(needle) ||
    entry.label.toLowerCase().includes(needle)
  );
}

function stripParentPrefix(childLabel: string, parentLabel: string): string {
  const prefix = parentLabel.endsWith('/') ? parentLabel : `${parentLabel}/`;
  return childLabel.startsWith(prefix)
    ? childLabel.slice(prefix.length)
    : childLabel;
}

export function buildSourceTree(
  sources: ReadonlyArray<SourceListingEntry>,
  query: string,
  expandedGroupIds: ReadonlySet<string>,
): SourceTreeResult {
  const needle = query.toLowerCase();
  const hasQuery = needle !== '';

  const childrenByParent = new Map<string, SourceListingEntry[]>();
  for (const entry of sources) {
    if (entry.parentId === undefined) continue;
    const arr = childrenByParent.get(entry.parentId) ?? [];
    arr.push(entry);
    childrenByParent.set(entry.parentId, arr);
  }

  const matchedIds = new Set<string>();
  if (hasQuery) {
    for (const entry of sources) {
      if (entryMatches(entry, needle)) matchedIds.add(entry.id);
    }
  }

  const topLevel = sources.filter((e) => e.parentId === undefined);

  const rows: SourceRow[] = [];
  let matchCount = 0;

  for (const entry of topLevel) {
    const children = childrenByParent.get(entry.id) ?? [];
    const isGroup = children.length > 0;

    if (!isGroup) {
      if (hasQuery && !matchedIds.has(entry.id)) continue;
      const match = hasQuery ? getMatchSpan(entry.label, needle) : undefined;
      if (hasQuery && matchedIds.has(entry.id)) matchCount++;
      rows.push({
        kind: 'leaf',
        entry,
        depth: 0,
        displayLabel: entry.label,
        match,
      });
      continue;
    }

    const groupSelfMatched = hasQuery && matchedIds.has(entry.id);
    const matchedChildren = hasQuery
      ? children.filter((c) => matchedIds.has(c.id))
      : [];

    if (hasQuery && !groupSelfMatched && matchedChildren.length === 0) continue;

    const userExpanded = expandedGroupIds.has(entry.id);
    const expanded = hasQuery
      ? matchedChildren.length > 0 || (groupSelfMatched && userExpanded)
      : userExpanded;

    rows.push({
      kind: 'group',
      entry,
      displayLabel: entry.label,
      childCount: children.length,
      matchedChildCount: matchedChildren.length,
      expanded,
      selectable: !hasQuery || groupSelfMatched,
      match: hasQuery ? getMatchSpan(entry.label, needle) : undefined,
    });
    if (groupSelfMatched) matchCount++;

    if (!expanded) continue;

    const visibleChildren = hasQuery ? matchedChildren : children;
    for (const child of visibleChildren) {
      const displayLabel = stripParentPrefix(child.label, entry.label);
      const childMatched = hasQuery && matchedIds.has(child.id);
      if (childMatched) matchCount++;
      rows.push({
        kind: 'leaf',
        entry: child,
        depth: 1,
        displayLabel,
        match: childMatched ? getMatchSpan(displayLabel, needle) : undefined,
      });
    }
  }

  return {
    rows,
    matchCount,
    totalCount: sources.length,
    empty: hasQuery && rows.length === 0,
  };
}
