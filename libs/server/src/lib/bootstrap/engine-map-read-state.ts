import type { ParsedSource } from 'core';
import type {
  LoadMetrics,
  SourceRuntime,
} from '../sources/source-row-projector';
import { isDiskBacked, manifestExists } from './disk-backed-index';
import { globIndexDir } from 'core';

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
): Promise<SourceRuntime> {
  if (entry.source.kind === 'endpoint') return { mode: 'endpoint' };
  if (isDiskBacked(entry.source)) {
    if (entry.current !== undefined) {
      const metrics = collectMetrics(entry);
      return metrics
        ? { mode: 'disk-backed', state: 'ready', metrics }
        : { mode: 'disk-backed', state: 'ready' };
    }
    if (entry.disk !== undefined) {
      return { mode: 'disk-backed', state: 'indexing' };
    }
    // Probe the on-disk manifest without opening — a `stat` of
    // `manifest.json` reports "ready" without acquiring the LevelDB lock.
    const indexDir = globIndexDir(
      configDir,
      entry.source.id as string,
      indexCacheDir,
    );
    const state = (await manifestExists(indexDir)) ? 'ready' : 'not-built';
    return { mode: 'disk-backed', state };
  }
  if (entry.current !== undefined) {
    const metrics = collectMetrics(entry);
    return metrics
      ? { mode: 'in-memory', state: 'loaded', metrics }
      : { mode: 'in-memory', state: 'loaded' };
  }
  // `loaded` is defined iff in-flight or settled-ok — the err path clears
  // the slot back to `undefined` (#290), so `not-loaded` covers both rest
  // and freshly-failed.
  if (entry.loaded !== undefined) return { mode: 'in-memory', state: 'loading' };
  return { mode: 'in-memory', state: 'not-loaded' };
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
