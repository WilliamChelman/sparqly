import { err, ok, type Result } from 'neverthrow';
import type { QueryEngine, SourceError } from 'core';
import { isDiskBacked } from './disk-backed-index';
import type { Entry, LoadedEntry } from './engine-map-types';
import type { SourceStateEmitter } from '../sources/source-state-emitter';

/**
 * Atomic-swap rebuild of an in-memory entry's materialized store. On success
 * transplants the freshly built store into the previously exposed `StoreRef`
 * so existing holders observe the new quads. In-flight queries against the
 * prior store finish naturally — N3 stores are never mutated in place.
 * Endpoint and disk-backed entries short-circuit.
 */
export async function reloadEntry(
  entry: Entry,
  loadEntry: (entry: Entry) => Promise<Result<LoadedEntry, SourceError>>,
): Promise<Result<QueryEngine, SourceError>> {
  if (entry.source.kind === 'endpoint') {
    return ok(entry.current!.engine);
  }
  if (isDiskBacked(entry.source)) {
    // Disk-backed reload is (Re)build index.
    return ok(entry.current!.engine);
  }
  const previousStoreRef = entry.current?.storeRef;
  // Force loadEntry to run end-to-end (it sets entry.current on success).
  entry.loaded = undefined;
  const loaded = await loadEntry(entry);
  if (loaded.isErr()) return err(loaded.error);
  // Memoize so a follow-up ensure doesn't re-run resolveSourceResult.
  entry.loaded = Promise.resolve(loaded);
  // Atomic swap: previously exposed ref now points at the new store; old
  // and new holders share the same `current`.
  if (previousStoreRef && loaded.value.storeRef) {
    previousStoreRef.current = loaded.value.storeRef.current;
    loaded.value.storeRef = previousStoreRef;
  }
  return ok(loaded.value.engine);
}

/**
 * Drops the live materialization of an in-memory entry. Idempotent — an
 * already-resting entry emits nothing so a split-glob cascade unload doesn't
 * spam SSE with no-ops. Endpoint and disk-backed entries short-circuit.
 */
export async function unloadEntry(
  id: string,
  entry: Entry,
  emitter: SourceStateEmitter | undefined,
): Promise<void> {
  if (entry.source.kind === 'endpoint') return;
  if (isDiskBacked(entry.source)) return;
  if (
    entry.current === undefined &&
    entry.loaded === undefined &&
    entry.closeIndex === undefined &&
    entry.loadedAt === undefined &&
    entry.loadMs === undefined
  ) {
    return;
  }
  if (entry.closeIndex) {
    try {
      await entry.closeIndex();
    } catch {
      // Best-effort lock release.
    }
    entry.closeIndex = undefined;
  }
  entry.current = undefined;
  entry.loaded = undefined;
  entry.loadedAt = undefined;
  entry.loadMs = undefined;
  // Keep `files` so the snippet allow-list doesn't shrink mid-flight.
  emitter?.emit({ kind: 'unload', sourceId: id });
}
