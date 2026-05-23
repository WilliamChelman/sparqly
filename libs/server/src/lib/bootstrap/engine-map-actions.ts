import { err, ok, type Result } from 'neverthrow';
import type { QueryEngine, SourceError } from 'core';
import { isDiskBacked } from './disk-backed-index';
import type { Entry, LoadedEntry } from './engine-map-types';
import type { SourceStateEmitter } from '../sources/source-state-emitter';

/**
 * Peer of `engine-map.ts` holding the imperative bodies of the **Source
 * admin actions** (#356) — `reloadEntry` and `unloadEntry`. Split out so
 * the `EngineMap` class file stays inside its `max-lines` lint cap; same
 * pattern as `engine-map-read-state.ts`. The class delegates to these
 * functions in one-liners and continues to own the public surface, the
 * memoization slot semantics, and the emitter wiring.
 */

/**
 * Atomic-swap rebuild of an in-memory entry's materialized store (#356).
 * Re-runs the same `loadEntry` path a first touch would; on success,
 * transplants the freshly built store into the previously exposed
 * `StoreRef` instance so existing holders see the new quads on their
 * next read while in-flight queries against the prior store finish
 * naturally. Endpoint and disk-backed entries short-circuit silently —
 * their reload semantics live elsewhere (ADR-0043 for disk-backed; an
 * endpoint has nothing to materialize).
 */
export async function reloadEntry(
  entry: Entry,
  loadEntry: (entry: Entry) => Promise<Result<LoadedEntry, SourceError>>,
): Promise<Result<QueryEngine, SourceError>> {
  if (entry.source.kind === 'endpoint') {
    // Pass-through — nothing to re-materialize. Return the pre-built engine.
    return ok(entry.current!.engine);
  }
  if (isDiskBacked(entry.source)) {
    // Out of scope for the in-memory verb — disk-backed reload is
    // (Re)build index (ADR-0043), wired in a later slice of #352.
    return ok(entry.current!.engine);
  }
  const previousStoreRef = entry.current?.storeRef;
  // Force loadEntry to run end-to-end — it sets entry.current to the
  // freshly resolved LoadedEntry on success and clears entry.loaded on err.
  entry.loaded = undefined;
  const loaded = await loadEntry(entry);
  if (loaded.isErr()) return err(loaded.error);
  // Memoize the new settled-ok promise so subsequent ensure(id) reads the
  // post-reload load result — without this, a follow-up ensure would
  // observe `entry.loaded === undefined` and re-run resolveSourceResult.
  entry.loaded = Promise.resolve(loaded);
  // Atomic swap: transplant the freshly built store into the previously
  // exposed ref so the same StoreRef instance now points at the new store.
  // The freshly built LoadedEntry's own engine reads via a closure over
  // its own ref; we update both refs to share the same `current` so old
  // and new holders observe identical state going forward.
  if (previousStoreRef && loaded.value.storeRef) {
    previousStoreRef.current = loaded.value.storeRef.current;
    loaded.value.storeRef = previousStoreRef;
  }
  return ok(loaded.value.engine);
}

/**
 * Drops the live materialization of an in-memory entry so the next
 * `ensure(id)` re-loads from scratch (#356). Idempotent: an entry that
 * is already at rest is a no-op (no emitter event) so a UI cascade
 * unload against a split glob does not spam the SSE stream with no-op
 * transitions for children that were never loaded. Endpoint and
 * disk-backed entries cannot be unloaded — they short-circuit silently.
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
    // Already at rest — emit nothing so a split-glob cascade unload doesn't
    // spam SSE with no-op transitions for children that were never loaded.
    return;
  }
  if (entry.closeIndex) {
    try {
      await entry.closeIndex();
    } catch {
      // Best-effort lock release on unload — same posture as close().
    }
    entry.closeIndex = undefined;
  }
  entry.current = undefined;
  entry.loaded = undefined;
  entry.loadedAt = undefined;
  entry.loadMs = undefined;
  // Files baked at materialization stay so the snippet allow-list doesn't
  // shrink mid-flight; the next `ensure(id)` overwrites them with the
  // freshly resolved paths anyway.
  emitter?.emit({ kind: 'unload', sourceId: id });
}
