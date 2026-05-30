import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ParsedSource } from 'core';
import {
  diskBackedIndexIdentity,
  globIndexDir,
  indexDbDir,
  inspectGlobIndexFreshness,
  readGlobIndexManifest,
  type GlobIndexFreshness,
  type GlobIndexManifest,
  type ParsedFileSource,
  type ParsedGlobSource,
  type ParsedTransform,
} from 'core';
import type {
  DiskBackedState,
  DiskExtras,
  LoadMetrics,
  SourceRowError,
  SourceRuntime,
} from '../sources/source-row-projector';
import type { SourceStateEmitter } from '../sources/source-state-emitter';
import { isDiskBacked, manifestExists } from './disk-backed-index';

/** Narrow structural view of an `EngineMap` entry — kept slim so peer modules
 * don't reach the full `Entry` shape across boundaries. */
export interface EntryStateView {
  source: ParsedSource;
  current: { storeRef?: { current: { size: number } } | undefined } | undefined;
  disk: unknown;
  loaded: unknown;
  files: ReadonlyArray<string>;
  loadedAt: number | undefined;
  loadMs: number | undefined;
  // Worker-owned quad count (ADR-0050); used when there is no main-heap store.
  quads?: number | undefined;
  lastError: SourceRowError | undefined;
}

/** Never triggers lazy materialization and never spawns a child build. */
export async function projectEntryState(
  entry: EntryStateView,
  configDir: string,
  indexCacheDir: string | undefined,
  sparqlyVersion: string | undefined,
  isBuilding: (sourceId: string) => boolean,
): Promise<SourceRuntime> {
  if (entry.source.kind === 'endpoint') return { mode: 'endpoint' };
  if (isDiskBacked(entry.source)) {
    return projectDiskBackedState(
      entry,
      entry.source,
      configDir,
      indexCacheDir,
      sparqlyVersion,
      isBuilding,
    );
  }
  if (entry.current !== undefined) {
    const metrics = collectMetrics(entry);
    return metrics
      ? { mode: 'in-memory', state: 'loaded', metrics }
      : { mode: 'in-memory', state: 'loaded' };
  }
  // In-flight load takes precedence over `lastError` — Retry repaints `loading`,
  // not the stale failure.
  if (entry.loaded !== undefined) return { mode: 'in-memory', state: 'loading' };
  if (entry.lastError !== undefined) {
    return { mode: 'in-memory', state: 'failed', error: entry.lastError };
  }
  return { mode: 'in-memory', state: 'not-loaded' };
}

async function projectDiskBackedState(
  entry: EntryStateView,
  source: ParsedGlobSource | ParsedFileSource,
  configDir: string,
  indexCacheDir: string | undefined,
  sparqlyVersion: string | undefined,
  isBuilding: (sourceId: string) => boolean,
): Promise<SourceRuntime> {
  const { indexId, pattern } = diskBackedIndexIdentity(source);
  const indexDir = globIndexDir(configDir, indexId, indexCacheDir);
  // The pool is the source of truth for in-flight builds — `entry.disk` is
  // also set on successful opens so it can't distinguish the two.
  if (entry.source.id !== undefined && isBuilding(entry.source.id)) {
    return diskBackedRuntime(entry, 'indexing', { indexDir });
  }
  const priorManifest = (await manifestExists(indexDir))
    ? await tryReadManifest(indexDir)
    : undefined;
  const extras: DiskExtras = { indexDir };
  extras.indexBytes = await tryWalkIndexBytes(indexDbDir(indexDir));
  if (priorManifest !== undefined) {
    extras.manifestSparqlyVersion = priorManifest.sparqlyVersion;
  }
  // Sticky-failed takes precedence over the manifest/staleness branches.
  if (entry.lastError !== undefined) {
    const metrics = collectMetrics(entry);
    const base: SourceRuntime = metrics
      ? { mode: 'disk-backed', state: 'failed', metrics, disk: extras }
      : { mode: 'disk-backed', state: 'failed', disk: extras };
    return { ...base, error: entry.lastError };
  }
  if (priorManifest === undefined) {
    return diskBackedRuntime(entry, 'not-built', extras);
  }
  // Run freshness comparison every time, even when the entry holds an open
  // index — sparqly never silently rebuilds, so `stale` must keep surfacing.
  const staleness = await tryInspectFreshness({
    glob: pattern,
    transforms: source.transforms ?? [],
    indexDir,
    sparqlyVersion: sparqlyVersion ?? priorManifest.sparqlyVersion,
  });
  if (staleness?.verdict === 'stale') {
    extras.staleReason = staleness.reason;
    return diskBackedRuntime(entry, 'stale', extras, priorManifest.quadCount);
  }
  return diskBackedRuntime(entry, 'ready', extras, priorManifest.quadCount);
}

function diskBackedRuntime(
  entry: EntryStateView,
  state: DiskBackedState,
  disk: DiskExtras,
  manifestQuadCount?: number,
): SourceRuntime {
  const metrics = collectMetrics(entry);
  // `quads` on disk-backed comes from the manifest, not the in-process load.
  const withQuads: LoadMetrics | undefined =
    manifestQuadCount !== undefined && metrics !== undefined
      ? { ...metrics, quads: manifestQuadCount }
      : manifestQuadCount !== undefined
        ? {
            files: entry.files.length,
            loadedAt: 0,
            loadMs: 0,
            quads: manifestQuadCount,
          }
        : metrics;
  return withQuads !== undefined
    ? { mode: 'disk-backed', state, metrics: withQuads, disk }
    : { mode: 'disk-backed', state, disk };
}

// Torn/unreadable manifest → treat as no manifest so the snapshot endpoint
// can't crash on a corrupt index.
async function tryReadManifest(
  indexDir: string,
): Promise<GlobIndexManifest | undefined> {
  try {
    return await readGlobIndexManifest(indexDir);
  } catch {
    return undefined;
  }
}

async function tryWalkIndexBytes(dbDir: string): Promise<number | undefined> {
  try {
    let total = 0;
    const entries = await readdir(dbDir, { withFileTypes: true });
    for (const file of entries) {
      const full = join(dbDir, file.name);
      if (file.isDirectory()) {
        const nested = await tryWalkIndexBytes(full);
        if (nested !== undefined) total += nested;
        continue;
      }
      try {
        const stats = await stat(full);
        total += stats.size;
      } catch {
        // LevelDB compaction can churn files between readdir and stat.
      }
    }
    return total;
  } catch {
    return undefined;
  }
}

// Swallow I/O errors so a permission glitch never flips `ready` to stale.
async function tryInspectFreshness(options: {
  glob: string;
  transforms: ReadonlyArray<ParsedTransform>;
  indexDir: string;
  sparqlyVersion: string;
}): Promise<GlobIndexFreshness | undefined> {
  try {
    return await inspectGlobIndexFreshness(options);
  } catch {
    return undefined;
  }
}

function collectMetrics(entry: EntryStateView): LoadMetrics | undefined {
  if (entry.loadedAt === undefined || entry.loadMs === undefined) {
    return undefined;
  }
  const metrics: LoadMetrics = {
    files: entry.files.length,
    loadedAt: entry.loadedAt,
    loadMs: entry.loadMs,
  };
  const size = entry.current?.storeRef?.current.size ?? entry.quads;
  if (size !== undefined) metrics.quads = size;
  return metrics;
}

export interface StaleDedupEntry {
  staleReasonSeen: string | undefined;
}

/**
 * De-duplicates `stale-detected` SSE emissions: only emits on a new reason or
 * on stale → ready → stale-same-reason. Pure observer — never clears on-disk
 * state.
 */
export function reconcileStaleDedup(
  entry: StaleDedupEntry,
  sourceId: string,
  runtime: SourceRuntime,
  stateEmitter: SourceStateEmitter | undefined,
): void {
  if (runtime.mode === 'disk-backed' && runtime.state === 'stale') {
    const reason = runtime.disk?.staleReason;
    if (reason !== undefined && reason !== entry.staleReasonSeen) {
      entry.staleReasonSeen = reason;
      stateEmitter?.emit({ kind: 'stale-detected', sourceId });
    }
    return;
  }
  if (entry.staleReasonSeen !== undefined) {
    entry.staleReasonSeen = undefined;
  }
}
