import type { RefEntry, RefKind, RefsResponse } from './refs-api.client';

const HEX_PREFIX = /^[0-9a-f]+$/i;
const FULL_SHA = /^[0-9a-f]{40}$/i;

const KIND_PRIORITY: Record<RefKind, number> = {
  head: 0,
  branch: 1,
  'remote-head': 2,
  'remote-branch': 3,
  'tag-annotated': 4,
  'tag-lightweight': 5,
};

function reproducibleRank(entry: RefEntry): number {
  if (entry.kind === 'tag-annotated') return 0;
  if (FULL_SHA.test(entry.ref)) return 0;
  return 1;
}

function alphaSort(entries: ReadonlyArray<RefEntry>): RefEntry[] {
  return [...entries].sort((a, b) => a.ref.localeCompare(b.ref));
}

function searchSort(entries: ReadonlyArray<RefEntry>): RefEntry[] {
  return [...entries].sort((a, b) => {
    const reproDiff = reproducibleRank(a) - reproducibleRank(b);
    if (reproDiff !== 0) return reproDiff;
    const kindDiff = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
    if (kindDiff !== 0) return kindDiff;
    return a.ref.localeCompare(b.ref);
  });
}

export function searchRefs(refs: RefsResponse, query: string): RefsResponse {
  if (query === '') {
    return {
      ...(refs.head !== undefined ? { head: refs.head } : {}),
      branches: alphaSort(refs.branches),
      remoteBranches: alphaSort(refs.remoteBranches),
      tags: alphaSort(refs.tags),
    };
  }
  const needle = query.toLowerCase();
  const shaMode = needle.length >= 4 && HEX_PREFIX.test(needle);
  const matches = (entry: RefEntry): boolean => {
    if (entry.ref.toLowerCase().includes(needle)) return true;
    if (shaMode && entry.sha.toLowerCase().startsWith(needle)) return true;
    return false;
  };
  const head = refs.head !== undefined && matches(refs.head) ? refs.head : undefined;
  return {
    ...(head !== undefined ? { head } : {}),
    branches: searchSort(refs.branches.filter(matches)),
    remoteBranches: searchSort(refs.remoteBranches.filter(matches)),
    tags: searchSort(refs.tags.filter(matches)),
  };
}
