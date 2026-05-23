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

/**
 * Structural view of an `EngineMap` entry that {@link projectEntryState}
 * needs to derive a {@link SourceRuntime}. Kept narrow on purpose — pulling
 * the full internal `Entry` shape across module boundaries would tangle
 * `engine-map.ts`'s privates with the projection. The actual `Entry`
 * type-checks against this shape thanks to structural typing.
 */
export interface EntryStateView {
  source: ParsedSource;
  /**
   * The settled-`ok` load shape, when present. Typed as a structural view of
   * the bits the projector actually reads — `storeRef.current.size` is the
   * in-memory `quads` metric (#355); everything else is opaque.
   */
  current: { storeRef?: { current: { size: number } } | undefined } | undefined;
  disk: unknown;
  loaded: unknown;
  /** Files baked into the materialized source — surfaces as Layer 2 `files`. */
  files: ReadonlyArray<string>;
  /** Epoch-ms stamp of the last successful load (#355). */
  loadedAt: number | undefined;
  /** Wall-clock ms the last successful load took (#355). */
  loadMs: number | undefined;
  /**
   * Layer 5 failure surface (#360). The most recent load / build failure for
   * this entry, populated by `loadEntry` (in-memory) or the index build
   * pool's settlement (disk-backed). Drives the projector's `failed` branch.
   */
  lastError: SourceRowError | undefined;
}

/**
 * Pure projection from an entry's bookkeeping fields to the Sources-page
 * **Source load state** (#353, parent #352). Lives outside the class so
 * `engine-map.ts` stays under the `max-lines` lint cap and so the
 * projection rules can be unit-tested in isolation. Never triggers lazy
 * materialization (ADR-0031) and never spawns a child-process build
 * (ADR-0042).
 */
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
  // An in-flight load takes precedence over a captured `lastError` — the
  // operator clicked Retry (or the next query touch fired a self-heal) and
  // the page should paint `loading`, not the stale failure. Layer 5 (#360):
  // we land here on first-touch failures whose load slot has already cleared
  // for ADR-0031 self-heal, so an inline `error` block survives between
  // touches until the next successful ensure() resets it via load-start.
  if (entry.loaded !== undefined) return { mode: 'in-memory', state: 'loading' };
  if (entry.lastError !== undefined) {
    return { mode: 'in-memory', state: 'failed', error: entry.lastError };
  }
  return { mode: 'in-memory', state: 'not-loaded' };
}

/**
 * Disk-backed branch of {@link projectEntryState} (#357). Threads Layer 3
 * extras — `indexDir`, `indexBytes`, `manifestSparqlyVersion`, and (for
 * `stale`) `staleReason` — onto the {@link SourceRuntime} so the **Sources
 * page** can surface them without opening the index. `indexDir` is layout-
 * derivable so it ships even on `not-built`; `indexBytes` and
 * `manifestSparqlyVersion` require a manifest. Stale detection re-globs and
 * compares against the stored manifest via {@link compareGlobIndexManifests}
 * — a mismatch flips the state to `stale` with a human-readable reason
 * (sparqly never silently rebuilds; ADR-0041).
 */
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
  // An in-flight child-process build always reports `indexing` — the manifest
  // is mid-write, and `compareGlobIndexManifests` would either fail to read
  // it or compare against torn state. The build pool is the source of truth
  // here; `entry.disk` is set on successful opens too, so it cannot be used
  // as the in-flight signal.
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
  // Sticky-failed (#360): the most recent child-process index build for this
  // source failed and no Retry has cleared it. Surface `failed` with the
  // inline error block — the Sources page renders the kind chip + Show
  // details + Retry button from it. Takes precedence over the manifest /
  // staleness branches so a prior good manifest that's since failed a
  // rebuild still reads `failed` until the user Retries again.
  if (entry.lastError !== undefined) {
    const metrics = collectMetrics(entry);
    const base: SourceRuntime = metrics
      ? { mode: 'disk-backed', state: 'failed', metrics, disk: extras }
      : { mode: 'disk-backed', state: 'failed', disk: extras };
    return { ...base, error: entry.lastError };
  }
  // No manifest → never built. Layer 3 carries `indexDir` (and possibly a
  // half-built directory's `indexBytes`) so the page can still show *where*
  // the index will land.
  if (priorManifest === undefined) {
    return diskBackedRuntime(entry, 'not-built', extras);
  }
  // Has a manifest — run the freshness comparison every time, *even when
  // the entry has an in-process load* (#357). Sparqly never silently
  // rebuilds (ADR-0043): a stale verdict must keep surfacing as `stale` on
  // the Sources page until the user clicks rebuild, regardless of whether
  // the open path is holding the index open. The source's current parsed
  // transform pipeline is the comparison's "current" side — a re-pointed
  // transform config registers as drift just like a changed file mtime.
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

/**
 * Assembles a disk-backed {@link SourceRuntime} with Layer 2 metrics (`quads`
 * from the manifest's `quadCount`, plus any in-process load timing) and the
 * Layer 3 extras pre-collected by the caller. Kept in one place so every
 * branch of {@link projectDiskBackedState} produces an identically-shaped
 * runtime object.
 */
function diskBackedRuntime(
  entry: EntryStateView,
  state: DiskBackedState,
  disk: DiskExtras,
  manifestQuadCount?: number,
): SourceRuntime {
  const metrics = collectMetrics(entry);
  // `quads` on disk-backed `ready`/`stale` is sourced from the manifest's
  // `quadCount` (#357). The in-process load doesn't surface a Quadstore size
  // anyway, so the manifest is the authoritative count.
  const withQuads: LoadMetrics | undefined =
    manifestQuadCount !== undefined && metrics !== undefined
      ? { ...metrics, quads: manifestQuadCount }
      : manifestQuadCount !== undefined
        ? // Synthesize a minimal metrics block so the projector sees `quads`
          // even when no in-process load has timestamps to report. The
          // projector strips Layer 2 when state is neither `ready` nor
          // `loaded`, so synthesizing this on `stale` is harmless.
          {
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

/**
 * Reads the manifest at `indexDir`, swallowing any read error and returning
 * `undefined`. A torn or unreadable manifest is treated as "no manifest" so
 * the snapshot endpoint can't crash on a corrupt index; the broken state
 * will surface separately when a query tries to open the index.
 */
async function tryReadManifest(
  indexDir: string,
): Promise<GlobIndexManifest | undefined> {
  try {
    return await readGlobIndexManifest(indexDir);
  } catch {
    return undefined;
  }
}

/**
 * Sums the sizes of every file under `dbDir` for the Layer 3 `indexBytes`
 * field (#357). Returns `undefined` when the directory does not exist or
 * cannot be read — the page renders blank for "unknown" rather than `0`.
 */
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
        // Skip files that vanished between readdir and stat (LevelDB
        // compaction can churn files mid-read).
      }
    }
    return total;
  } catch {
    return undefined;
  }
}

/**
 * Re-globs the matched files and asks core for a freshness verdict. Swallows
 * any I/O error and returns `undefined` so a permission glitch never converts
 * a `ready` row into a stale one (the open path's existing stale `warn` log
 * remains the authoritative signal for query-time freshness).
 */
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

/**
 * Reads the Layer 2 materialization metrics off an entry once it is settled
 * `loaded`/`ready`. Returns `undefined` when the entry has no recorded
 * `loadedAt` — that happens for pre-seeded endpoint pass-throughs (which the
 * projector never surfaces metrics for anyway) and for disk-backed `ready`
 * paths that haven't actually opened in this lifetime yet. `quads` is read
 * off the live `StoreRef` for in-memory loaded; disk-backed leaves it
 * `undefined` until the manifest's `quadCount` ships (#352 forward-compat).
 */
function collectMetrics(entry: EntryStateView): LoadMetrics | undefined {
  if (entry.loadedAt === undefined || entry.loadMs === undefined) {
    return undefined;
  }
  const metrics: LoadMetrics = {
    files: entry.files.length,
    loadedAt: entry.loadedAt,
    loadMs: entry.loadMs,
  };
  const size = entry.current?.storeRef?.current.size;
  if (size !== undefined) metrics.quads = size;
  return metrics;
}

/**
 * Structural view of the per-entry mutable slot that {@link reconcileStaleDedup}
 * reads and writes — the entry's `staleReasonSeen` cache. Kept narrow for the
 * same reason as {@link EntryStateView}: peer modules shouldn't reach the full
 * `Entry` shape across module boundaries.
 */
export interface StaleDedupEntry {
  staleReasonSeen: string | undefined;
}

/**
 * Bridges a fresh {@link SourceRuntime} into a single de-duplicated
 * `stale-detected` SSE emission (#357). A drift verdict that matches what
 * `EngineMap.readState` already broadcast is suppressed — the row payload
 * hasn't moved and the Sources page is already painting the right state. A
 * *new* reason (a different file changed, the sparqly version moved) re-emits
 * so the row text updates. Exiting `stale` clears the cache so the next
 * stale → ready → stale-with-same-reason transition still fires
 * exactly one fresh `stale-detected`. Sparqly never silently rebuilds
 * (ADR-0043); this helper only observes — it never clears the on-disk state.
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
