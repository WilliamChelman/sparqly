import { err, ok, type Result, type ResultAsync } from 'neverthrow';
import {
  resolveSourceResult,
  type ParsedSource,
  type QueryExecutor,
  type SourceError,
} from 'core';
import type { SparqlyLogger } from 'common';
import { isDiskBacked } from './disk-backed-index';
import type { Entry, LoadedEntry, LoadedSources } from './engine-map-types';
import type { QueryWorkerPool } from '../sparql/query-worker-pool';
import type { SourceStateEmitter } from '../sources/source-state-emitter';

export interface FreshResolveDeps {
  registry: ReadonlyArray<ParsedSource>;
  logger: SparqlyLogger | undefined;
  configDir: string;
  sparqlyVersion: string | undefined;
  indexCacheDir: string | undefined;
}

/**
 * ADR-0050: a worker-owned store isn't on the main heap, so callers that need
 * the actual store (e.g. `diff`) resolve it fresh on main rather than reusing
 * the worker's resident copy. Projects the resolved sources into the
 * {@link LoadedSources} shape `ensureSources` returns.
 */
export function resolveFreshWorkerSources(
  source: ParsedSource,
  deps: FreshResolveDeps,
): ResultAsync<LoadedSources, SourceError> {
  return resolveSourceResult(source, deps).map((sources) =>
    sources.mode === 'materialized'
      ? {
          mode: 'materialized',
          store: sources.store,
          sourceRecords: sources.sourceRecords,
        }
      : sources.mode === 'pass-through'
        ? { mode: 'pass-through', endpoint: sources.endpoint }
        : { mode: 'materialized-remote' },
  );
}

/**
 * ADR-0050 (#391): drop the worker-resident store for a watched in-memory source
 * so the next query rebuilds it from the worker's recipe with fresh on-disk
 * content. Returns `true` only when the worker owns this source *and* it is
 * currently loaded — the `--watch` runner then skips its legacy main-thread
 * rebuild. Returns `false` otherwise (no query pool, endpoint/disk-backed, or an
 * un-touched source whose resident store there is nothing to drop), preserving
 * the ADR-0031 laziness.
 */
export function invalidateWorkerResident(
  entry: Entry | undefined,
  pool: QueryWorkerPool | undefined,
): boolean {
  if (entry === undefined || pool === undefined) return false;
  if (entry.source.kind === 'endpoint' || isDiskBacked(entry.source)) return false;
  if (entry.current === undefined) return false;
  pool.invalidate(entry.source.id as string);
  return true;
}

/**
 * ADR-0050: a reclaimed worker (nuclear cancel / OOM respawn) lost its stores —
 * drop each orphaned source's memo so the next touch rebuilds it on the respawn.
 */
export function resetWorkerResidency(
  entries: Map<string, Entry>,
  pool: QueryWorkerPool | undefined,
  sourceIds: ReadonlyArray<string>,
): void {
  if (pool === undefined) return;
  for (const id of sourceIds) {
    const entry = entries.get(id);
    if (entry !== undefined && entry.source.kind !== 'endpoint') {
      entry.loaded = undefined;
      entry.current = undefined;
    }
  }
}

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
): Promise<Result<QueryExecutor, SourceError>> {
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
  // Supersede any in-flight load: a worker round-trip that resolves after this
  // Unload must discard its result rather than re-populate the cleared entry.
  entry.loadEpoch += 1;
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
  entry.quads = undefined;
  // Keep `files` so the snippet allow-list doesn't shrink mid-flight.
  emitter?.emit({ kind: 'unload', sourceId: id });
}
