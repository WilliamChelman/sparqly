import type { ParsedSource } from 'core';

export type SourceRow =
  | ({
      mode: 'in-memory';
      id: string;
      kind: 'glob' | 'file' | 'view' | 'empty';
      state: InMemoryState;
      default?: true;
      parentId?: string;
    } & Layer2Fields &
      Layer5Fields)
  | ({
      mode: 'disk-backed';
      id: string;
      kind: 'glob' | 'file';
      state: DiskBackedState;
      default?: true;
      parentId?: string;
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

/**
 * Pure mapping from a {@link ParsedSource} + its {@link SourceRuntime} to the
 * wire row. Reference sources are filtered by the caller — they're never served.
 */
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

// `error` is gated on `state === 'failed'` so the wire shape can't lie about
// the state machine — a stray error on a non-failed state is dropped.
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

function withOptionalDefault(row: SourceRow, isDefault: true | undefined): SourceRow {
  if (isDefault === true) {
    return { ...row, default: true } as SourceRow;
  }
  return row;
}
