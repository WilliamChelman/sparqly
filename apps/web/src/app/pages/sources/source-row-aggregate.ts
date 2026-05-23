import type { SourceRow } from './source-row';

export function hasLoadedChild(row: SourceRow): boolean {
  if (row.mode === 'endpoint') return false;
  const children = row.children;
  if (children === undefined) return false;
  for (const c of children) {
    if (c.mode === 'endpoint') continue;
    if (c.state === 'loaded' || c.state === 'ready') return true;
  }
  return false;
}

export function loadedChildIds(row: SourceRow): string[] {
  if (row.mode === 'endpoint') return [];
  const children = row.children;
  if (children === undefined) return [];
  const ids: string[] = [];
  for (const c of children) {
    if (c.mode === 'endpoint') continue;
    if (c.state === 'loaded' || c.state === 'ready') ids.push(c.id);
  }
  return ids;
}

export function errorMessageFirstLine(message: string): string {
  const newline = message.indexOf('\n');
  return newline === -1 ? message : message.slice(0, newline);
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && v >= 1024; i++) {
    v /= 1024;
    unit = units[i];
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${unit}`;
}

export function reaggregateMeta(meta: SourceRow, child: SourceRow): SourceRow {
  if (meta.mode === 'endpoint') return meta;
  if (meta.children === undefined) return meta;
  let replaced = false;
  const nextChildren = meta.children.map((c) => {
    if (c.id !== child.id) return c;
    replaced = true;
    return child;
  });
  if (!replaced) nextChildren.push(child);
  return {
    ...meta,
    children: nextChildren,
    ...summarizeMeta(nextChildren, meta),
  } as SourceRow;
}

function summarizeMeta(
  children: SourceRow[],
  meta: SourceRow,
): {
  state: string;
  quads?: number;
  files?: number;
  loadedAt?: number;
  loadMs?: undefined;
} {
  const stateOf = (r: SourceRow): string =>
    r.mode === 'endpoint' ? 'endpoint' : r.state;
  let state: string;
  if (children.length === 0) {
    state = stateOf(meta);
  } else {
    state = stateOf(children[0]);
    for (let i = 1; i < children.length; i++) {
      if (stateOf(children[i]) !== state) {
        state = 'mixed';
        break;
      }
    }
  }
  let quads: number | undefined;
  let files = 0;
  let loadedAt: number | undefined;
  for (const c of children) {
    if (c.mode === 'endpoint') continue;
    if (c.state !== 'loaded' && c.state !== 'ready') continue;
    if (typeof c.files === 'number') files += c.files;
    if (typeof c.quads === 'number') quads = (quads ?? 0) + c.quads;
    if (typeof c.loadedAt === 'number') {
      loadedAt =
        loadedAt === undefined ? c.loadedAt : Math.max(loadedAt, c.loadedAt);
    }
  }
  const out: { state: string; quads?: number; files?: number; loadedAt?: number; loadMs?: undefined } = {
    state,
    loadMs: undefined,
  };
  if (quads !== undefined) out.quads = quads;
  if (files > 0 || loadedAt !== undefined) out.files = files;
  if (loadedAt !== undefined) out.loadedAt = loadedAt;
  return out;
}
