import { err, ok, type Result } from 'neverthrow';
import type { SparqlyLogger } from 'common';
import { formatSourceError, type SourceError } from 'core';
import { WorkerQueryExecutor } from '../sparql/query-worker-executor';
import type { QueryWorkerPool } from '../sparql/query-worker-pool';
import type { WorkerResolveOptions } from '../sparql/query-worker-protocol';
import type { SourceStateEmitter } from '../sources/source-state-emitter';
import type { Entry, LoadedEntry } from './engine-map-types';

/**
 * ADR-0050: hand the build to the query worker, which owns the store. The
 * `loading → loaded → failed` transitions originate in the worker's reply; main
 * keeps only the thin state mirror (`entry.current`, `files`, `loadMs`, `quads`)
 * the Sources page reads. Mirrors {@link loadEntry}'s main-heap counterpart so
 * `readState` projects the same `SourceRuntime` either way.
 */
export async function loadEntryViaWorker(
  entry: Entry,
  pool: QueryWorkerPool,
  resolveOptions: WorkerResolveOptions,
  stateEmitter: SourceStateEmitter | undefined,
  logger: SparqlyLogger | undefined,
): Promise<Result<LoadedEntry, SourceError>> {
  const src = entry.source;
  const sourceId = src.id as string;
  // Clear prior failure so the row reads `loading` for this attempt's lifetime.
  entry.lastError = undefined;
  stateEmitter?.emit({ kind: 'load-start', sourceId });
  const result = await pool.ensureLoaded(src, resolveOptions);
  if (result.isErr()) {
    entry.loaded = undefined;
    entry.lastError = {
      kind: result.error.kind,
      message: formatSourceError(result.error),
    };
    stateEmitter?.emit({ kind: 'load-failure', sourceId });
    return err(result.error);
  }
  const info = result.value;
  const loaded: LoadedEntry = {
    engine: new WorkerQueryExecutor(pool, sourceId),
    storeRef: undefined,
    sources: { mode: 'materialized-remote' },
  };
  entry.current = loaded;
  entry.files = [...info.files];
  entry.loadMs = info.loadMs;
  entry.loadedAt = Date.now();
  entry.quads = info.quads;
  stateEmitter?.emit({ kind: 'load-success', sourceId });
  logger?.debug('source-loaded', {
    source: sourceId,
    kind: src.kind,
    files: entry.files.length,
    quads: info.quads,
    ms: info.loadMs,
  });
  return ok(loaded);
}
