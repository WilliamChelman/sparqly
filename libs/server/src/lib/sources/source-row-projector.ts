import type { ParsedSource } from 'core';

export type SourceRow =
  | ({
      mode: 'in-memory';
      id: string;
      kind: 'glob' | 'file' | 'view' | 'empty';
      state: InMemoryState | 'mixed';
      default?: true;
      parentId?: string;
      children?: SourceRow[];
    } & Layer2Fields &
      Layer5Fields)
  | ({
      mode: 'disk-backed';
      id: string;
      kind: 'glob' | 'file';
      state: DiskBackedState | 'mixed';
      default?: true;
      parentId?: string;
      children?: SourceRow[];
    } & Layer2Fields &
      Layer3Fields &
      Layer5Fields)
  | ({
      mode: 'endpoint';
      id: string;
      kind: 'endpoint';
      default?: true;
    } & Layer4Fields);

interface Layer2Fields {
  quads?: number;
  files?: number;
  loadedAt?: number;
  loadMs?: number;
}

export interface LoadMetrics {
  quads?: number;
  files: number;
  loadedAt: number;
  loadMs: number;
}

interface Layer3Fields {
  indexDir?: string;
  indexBytes?: number;
  manifestSparqlyVersion?: string;
  /** Populated exactly when `state === 'stale'`. */
  staleReason?: string;
}

interface Layer4Fields {
  endpointUrl?: string;
}

interface Layer5Fields {
  error?: SourceRowError;
}

export interface SourceRowError {
  kind: string;
  message: string;
  details?: string;
}

export interface DiskExtras {
  indexDir?: string;
  indexBytes?: number;
  manifestSparqlyVersion?: string;
  staleReason?: string;
}

export type InMemoryState = 'not-loaded' | 'loading' | 'loaded' | 'failed';

export type DiskBackedState =
  | 'not-built'
  | 'indexing'
  | 'ready'
  | 'stale'
  | 'failed';

export type SourceRuntime =
  | {
      mode: 'in-memory';
      state: InMemoryState;
      metrics?: LoadMetrics;
      error?: SourceRowError;
    }
  | {
      mode: 'disk-backed';
      state: DiskBackedState;
      metrics?: LoadMetrics;
      disk?: DiskExtras;
      error?: SourceRowError;
    }
  | { mode: 'endpoint' };

export function projectSourceRow(
  source: ParsedSource,
  runtime: SourceRuntime,
): SourceRow {
  if (source.id === undefined) {
    throw new Error(
      `projectSourceRow: source of kind '${source.kind}' has no id — ` +
        `parse must have filled it in before the Sources page sees it`,
    );
  }
  const id = source.id;
  const isDefault =
    (source as { default?: true }).default === true ? true : undefined;
  const parentId =
    source.kind === 'file' ? source.parentId : undefined;
  if (runtime.mode === 'endpoint') {
    if (source.kind !== 'endpoint') {
      throw new Error(
        `projectSourceRow: endpoint runtime requires kind 'endpoint' (got '${source.kind}')`,
      );
    }
    return withOptionalDefault(
      {
        mode: 'endpoint',
        id,
        kind: 'endpoint',
        endpointUrl: source.endpoint,
      },
      isDefault,
    );
  }
  if (runtime.mode === 'disk-backed') {
    if (source.kind !== 'glob' && source.kind !== 'file') {
      throw new Error(
        `projectSourceRow: disk-backed runtime requires kind 'glob' or 'file' (got '${source.kind}')`,
      );
    }
    const row: SourceRow = {
      mode: 'disk-backed',
      id,
      kind: source.kind,
      state: runtime.state,
    };
    if (parentId !== undefined) row.parentId = parentId;
    if (runtime.state === 'ready') applyLayer2(row, runtime.metrics);
    applyLayer3(row, runtime.state, runtime.disk);
    applyLayer5(row, runtime.state, runtime.error);
    return withOptionalDefault(row, isDefault);
  }
  if (
    source.kind !== 'glob' &&
    source.kind !== 'file' &&
    source.kind !== 'view' &&
    source.kind !== 'empty'
  ) {
    throw new Error(
      `projectSourceRow: in-memory runtime rejects kind '${source.kind}'`,
    );
  }
  const row: SourceRow = {
    mode: 'in-memory',
    id,
    kind: source.kind,
    state: runtime.state,
  };
  if (parentId !== undefined) row.parentId = parentId;
  if (runtime.state === 'loaded') applyLayer2(row, runtime.metrics);
  applyLayer5(row, runtime.state, runtime.error);
  return withOptionalDefault(row, isDefault);
}

function applyLayer2(
  row: SourceRow & Layer2Fields,
  metrics: LoadMetrics | undefined,
): void {
  if (metrics === undefined) return;
  if (metrics.quads !== undefined) row.quads = metrics.quads;
  row.files = metrics.files;
  row.loadedAt = metrics.loadedAt;
  row.loadMs = metrics.loadMs;
}

function applyLayer3(
  row: SourceRow & Layer3Fields,
  state: DiskBackedState,
  extras: DiskExtras | undefined,
): void {
  if (extras === undefined) return;
  if (extras.indexDir !== undefined) row.indexDir = extras.indexDir;
  if (extras.indexBytes !== undefined) row.indexBytes = extras.indexBytes;
  if (extras.manifestSparqlyVersion !== undefined) {
    row.manifestSparqlyVersion = extras.manifestSparqlyVersion;
  }
  if (state === 'stale' && extras.staleReason !== undefined) {
    row.staleReason = extras.staleReason;
  }
}

// `error` is gated on `state === 'failed'` so a stray error never leaks.
function applyLayer5(
  row: SourceRow & Layer5Fields,
  state: InMemoryState | DiskBackedState,
  error: SourceRowError | undefined,
): void {
  if (state !== 'failed' || error === undefined) return;
  row.error = error.details !== undefined
    ? { kind: error.kind, message: error.message, details: error.details }
    : { kind: error.kind, message: error.message };
}

/**
 * Projects one top-level Sources row, folding a split-glob meta's per-file
 * children under it. `children` is the meta's synthesized **File source**
 * children (empty for a non-split source). Shared by the snapshot controller
 * and the SSE broker so a live row and a freshly-fetched snapshot row are
 * projected identically — including a split-glob meta's `children` array and
 * its parent-union state (see {@link projectSplitGlobMeta}).
 */
export async function projectTopLevelRow(
  source: ParsedSource,
  children: ReadonlyArray<ParsedSource>,
  readState: (id: string) => Promise<SourceRuntime>,
): Promise<SourceRow> {
  const runtime = await readState(source.id as string);
  if (children.length === 0) {
    return projectSourceRow(source, runtime);
  }
  const childRows: SourceRow[] = [];
  for (const child of children) {
    if (child.id === undefined) continue;
    childRows.push(projectSourceRow(child, await readState(child.id)));
  }
  return projectSplitGlobMeta(source, runtime, childRows);
}

export function projectSplitGlobMeta(
  meta: ParsedSource,
  metaRuntime: SourceRuntime,
  children: SourceRow[],
): SourceRow {
  const row = projectSourceRow(meta, metaRuntime);
  if (row.mode === 'endpoint') {
    throw new Error(
      `projectSplitGlobMeta: split-glob meta cannot be endpoint kind (id '${row.id}')`,
    );
  }
  // The split-glob parent is itself a queryable union (`?source=<id>`), a
  // residency distinct from its per-file children. Once that union has been
  // directly touched (loading / loaded / failed), *it* is what serves queries —
  // surface the parent's own state, union metrics, and failure, keeping the
  // children as a breakdown. Only an untouched union (`not-loaded`) defers to
  // the children summary (the per-file load workflow).
  if (row.mode === 'in-memory' && row.state !== 'not-loaded') {
    return { ...row, children };
  }
  const aggregatedState = aggregateChildState(children, row.state);
  // Drop the meta's own metrics so a stale meta-runtime value can't leak
  // past the summary aggregated from children.
  const base = stripLayer2(row);
  const summary = summarizeChildMetrics(children);
  return { ...base, ...summary, state: aggregatedState, children } as SourceRow;
}

function stripLayer2<R extends SourceRow>(row: R): R {
  const { quads: _q, files: _f, loadedAt: _l, loadMs: _m, ...rest } =
    row as R & Layer2Fields;
  void _q; void _f; void _l; void _m;
  return rest as R;
}

function summarizeChildMetrics(children: SourceRow[]): Layer2Fields {
  const out: Layer2Fields = {};
  let quadsSum: number | undefined;
  let filesCount = 0;
  let latestLoadedAt: number | undefined;
  for (const child of children) {
    if (child.mode === 'endpoint') continue;
    if (!isLoadedState(child.state)) continue;
    if (typeof child.files === 'number') filesCount += child.files;
    if (typeof child.quads === 'number') {
      quadsSum = (quadsSum ?? 0) + child.quads;
    }
    if (typeof child.loadedAt === 'number') {
      latestLoadedAt =
        latestLoadedAt === undefined
          ? child.loadedAt
          : Math.max(latestLoadedAt, child.loadedAt);
    }
  }
  if (filesCount === 0 && quadsSum === undefined && latestLoadedAt === undefined) {
    return out;
  }
  if (quadsSum !== undefined) out.quads = quadsSum;
  out.files = filesCount;
  if (latestLoadedAt !== undefined) out.loadedAt = latestLoadedAt;
  return out;
}

function isLoadedState(state: string): boolean {
  return state === 'loaded' || state === 'ready';
}

// No children: meta keeps its own runtime state (zero-match warn case).
// All children share a state: meta carries that state.
// Otherwise: 'mixed'.
function aggregateChildState(
  children: SourceRow[],
  fallback: string,
): string {
  if (children.length === 0) return fallback;
  const first = childState(children[0]);
  for (let i = 1; i < children.length; i++) {
    if (childState(children[i]) !== first) return 'mixed';
  }
  return first;
}

function childState(row: SourceRow): string {
  if (row.mode === 'endpoint') return 'endpoint';
  return row.state;
}

function withOptionalDefault(row: SourceRow, isDefault: true | undefined): SourceRow {
  if (isDefault === true) {
    return { ...row, default: true } as SourceRow;
  }
  return row;
}
