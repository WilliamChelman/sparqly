import { err, ok, ResultAsync, type Result } from 'neverthrow';
import type {
  EndpointFetchError,
  ExecuteResult,
  ParsedSource,
  QueryExecutionError,
  SourceError,
  SparqlFormat,
} from 'core';
import type {
  QueryWorkerHandle,
  WorkerMessage,
  WorkerResolveOptions,
} from './query-worker-protocol';

export interface QueryWorkerPoolOptions {
  /** Spawns the single in-memory query worker. Injected so tests pass a fake. */
  spawn: () => QueryWorkerHandle;
}

/** Build metrics the state mirror surfaces in `/api/sources` (ADR-0044). */
export interface LoadInfo {
  quads: number;
  loadMs: number;
  files: ReadonlyArray<string>;
}

interface PendingQuery {
  resolve: (
    result: Result<ExecuteResult, QueryExecutionError | EndpointFetchError>,
  ) => void;
}

interface PendingLoad {
  promise: Promise<Result<LoadInfo, SourceError>>;
  resolve: (result: Result<LoadInfo, SourceError>) => void;
}

/**
 * Fronts the single in-memory query worker (ADR-0050, slice #385). Owns the
 * worker handle, correlates request↔reply by a monotonic `requestId`, and keeps
 * the CPU-bound Comunica work off the main event loop. Pool sizing, hash-sticky
 * assignment, LRU residency, and cancellation are later slices (#386–#390).
 */
export class QueryWorkerPool {
  private readonly worker: QueryWorkerHandle;
  private readonly pending = new Map<number, PendingQuery>();
  /** In-flight loads keyed by source id — concurrent touches coalesce here. */
  private readonly loads = new Map<string, PendingLoad>();
  private nextRequestId = 1;

  constructor(options: QueryWorkerPoolOptions) {
    this.worker = options.spawn();
    this.worker.on('message', (message) => this.onMessage(message));
  }

  /**
   * Asks the worker to build and memoize the source's store. Concurrent calls
   * for the same source share one `load` round-trip. Resolves with the build
   * metrics, or the typed {@link SourceError} the worker reports on failure.
   */
  ensureLoaded(
    source: ParsedSource,
    resolveOptions: WorkerResolveOptions,
  ): ResultAsync<LoadInfo, SourceError> {
    const sourceId = source.id as string;
    const inFlight = this.loads.get(sourceId);
    if (inFlight !== undefined) return new ResultAsync(inFlight.promise);
    let resolve!: (result: Result<LoadInfo, SourceError>) => void;
    const promise = new Promise<Result<LoadInfo, SourceError>>((r) => {
      resolve = r;
    });
    this.loads.set(sourceId, { promise, resolve });
    this.worker.postMessage({ type: 'load', sourceId, source, resolveOptions });
    return new ResultAsync(promise);
  }

  query(
    sourceId: string,
    query: string,
    options: { format?: SparqlFormat; mutable?: boolean },
  ): ResultAsync<ExecuteResult, QueryExecutionError | EndpointFetchError> {
    const requestId = this.nextRequestId++;
    const settled = new Promise<
      Result<ExecuteResult, QueryExecutionError | EndpointFetchError>
    >((resolve) => {
      this.pending.set(requestId, { resolve });
    });
    this.worker.postMessage({
      type: 'query',
      requestId,
      sourceId,
      query,
      format: options.format,
      mutable: options.mutable,
    });
    return new ResultAsync(settled);
  }

  async shutdown(): Promise<void> {
    await this.worker.terminate();
  }

  private onMessage(message: WorkerMessage): void {
    if (message.type === 'query-result') {
      const pending = this.pending.get(message.requestId);
      if (pending === undefined) return;
      this.pending.delete(message.requestId);
      pending.resolve(
        message.ok !== undefined ? ok(message.ok) : err(message.error!),
      );
      return;
    }
    const load = this.loads.get(message.sourceId);
    if (load === undefined) return;
    this.loads.delete(message.sourceId);
    load.resolve(
      message.type === 'load-success'
        ? ok({ quads: message.quads, loadMs: message.loadMs, files: message.files })
        : err(message.error),
    );
  }
}
