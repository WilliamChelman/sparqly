import { Worker, type WorkerOptions } from 'node:worker_threads';
import type { QueryWorkerHandle } from 'server';

export interface SpawnQueryWorkerOptions {
  /** `process.argv[1]` captured before `main.ts` overwrites it — the CLI bundle
   * the worker re-runs in `worker_thread` mode. */
  cliEntry: string;
  /** Per-worker LRU resident-quad budget (`query.maxResidentQuads`, ADR-0050).
   * Travels in `workerData` so the worker enforces it on its own thread; omitted
   * means the worker's built-in default applies. */
  maxResidentQuads?: number;
  /** Per-worker V8 old-generation ceiling in MB (`query.maxOldGenerationSizeMb`,
   * ADR-0050). Set as `resourceLimits.maxOldGenerationSizeMb` so an over-budget
   * query throws a catchable `ERR_WORKER_OUT_OF_MEMORY` that kills only this
   * worker — the hard backstop under the soft per-worker LRU governor. Omitted
   * means Node's default (effectively unbounded) heap applies. */
  maxOldGenerationSizeMb?: number;
  /** Injectable for tests; defaults to a real `worker_threads.Worker`. */
  createWorker?: (entry: string, options: WorkerOptions) => QueryWorkerHandle;
}

/**
 * Builds the `spawnQueryWorker` factory `createServer` calls to stand up the
 * ADR-0050 query worker. The worker is the same CLI bundle re-run with a
 * `sparqlyRole: 'query-worker'` marker in `workerData`, which `main.ts` detects
 * to host the worker loop instead of the commander program.
 */
export function makeSpawnQueryWorker(
  options: SpawnQueryWorkerOptions,
): () => QueryWorkerHandle {
  const create =
    options.createWorker ??
    ((entry: string, workerOptions: WorkerOptions): QueryWorkerHandle =>
      new Worker(entry, workerOptions) as unknown as QueryWorkerHandle);
  const workerOptions: WorkerOptions = {
    workerData: {
      sparqlyRole: 'query-worker',
      maxResidentQuads: options.maxResidentQuads,
    },
  };
  if (options.maxOldGenerationSizeMb !== undefined) {
    workerOptions.resourceLimits = {
      maxOldGenerationSizeMb: options.maxOldGenerationSizeMb,
    };
  }
  return () => create(options.cliEntry, workerOptions);
}
