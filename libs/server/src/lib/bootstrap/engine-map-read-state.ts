import type { ParsedSource } from 'core';
import type { SourceRuntime } from '../sources/source-row-projector';
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
  current: unknown;
  disk: unknown;
  loaded: unknown;
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
      return { mode: 'disk-backed', state: 'ready' };
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
  if (entry.current !== undefined) return { mode: 'in-memory', state: 'loaded' };
  // `loaded` is defined iff in-flight or settled-ok — the err path clears
  // the slot back to `undefined` (#290), so `not-loaded` covers both rest
  // and freshly-failed.
  if (entry.loaded !== undefined) return { mode: 'in-memory', state: 'loading' };
  return { mode: 'in-memory', state: 'not-loaded' };
}
