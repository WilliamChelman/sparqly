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

/** Default worker count, mirroring `index.concurrency` / {@link IndexBuildPool}. */
const DEFAULT_CONCURRENCY = 2;

/**
 * Maps a source to the worker that owns its store (ADR-0050). Kept behind this
 * seam so a future size-aware or sticky-with-overflow policy can replace the
 * pure hash-sticky default without touching the pool. The strategy is stateful
 * by contract — it may track per-worker load for later policies — so the pool
 * calls {@link assign} but never reasons about how the index is chosen.
 */
export interface AssignmentStrategy {
  /** Returns the 0-based worker index that owns `sourceId`. Must be stable for a
   * given id (sticky) and in `[0, workerCount)`. */
  assign(sourceId: string): number;
}

/**
 * Pure hash-sticky assignment: `hash(id) % workerCount`, fixed at construction.
 * A source therefore builds and memoizes its store on exactly one worker — no
 * duplication — and routes back to that same worker on every later request.
 */
export class HashStickyAssignment implements AssignmentStrategy {
  constructor(private readonly workerCount: number) {}

  assign(sourceId: string): number {
    return fnv1a(sourceId) % this.workerCount;
  }
}

/** FNV-1a, 32-bit — a small, dependency-free, well-distributed string hash. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface QueryWorkerPoolOptions {
  /** Spawns one in-memory query worker. Called up to `concurrency` times, once
   * per worker index the assignment strategy actually routes to. Injected so
   * tests pass a fake. */
  spawn: () => QueryWorkerHandle;
  /** Bounded pool size (`query.concurrency`, default 2). */
  concurrency?: number;
  /** Source→worker policy. Defaults to {@link HashStickyAssignment} over the
   * resolved `concurrency`. */
  assignment?: AssignmentStrategy;
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
 * Fronts a bounded pool of in-memory query workers (ADR-0050, slice #386). A
 * source is pinned to one worker by the injected {@link AssignmentStrategy}, so
 * its store is built and memoized on exactly one thread. The pool spawns up to
 * `concurrency` workers lazily — a worker index is materialized the first time a
 * source routes to it — correlates request↔reply by a monotonic `requestId`,
 * and keeps the CPU-bound Comunica work off the main event loop. LRU residency
 * and cancellation are later slices (#387–#390).
 */
export class QueryWorkerPool {
  private readonly spawn: () => QueryWorkerHandle;
  private readonly concurrency: number;
  private readonly assignment: AssignmentStrategy;
  /** Workers materialized so far, keyed by assignment index. */
  private readonly workers = new Map<number, QueryWorkerHandle>();
  private readonly pending = new Map<number, PendingQuery>();
  /** In-flight loads keyed by source id — concurrent touches coalesce here. */
  private readonly loads = new Map<string, PendingLoad>();
  private nextRequestId = 1;

  constructor(options: QueryWorkerPoolOptions) {
    this.spawn = options.spawn;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.assignment =
      options.assignment ?? new HashStickyAssignment(this.concurrency);
  }

  /** Resolves the worker owning `sourceId`, spawning it on first use. The same
   * id always resolves to the same worker (stickiness rests on the strategy). */
  private workerFor(sourceId: string): QueryWorkerHandle {
    const index = this.assignment.assign(sourceId);
    let worker = this.workers.get(index);
    if (worker === undefined) {
      worker = this.spawn();
      worker.on('message', (message) => this.onMessage(message));
      this.workers.set(index, worker);
    }
    return worker;
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
    this.workerFor(sourceId).postMessage({
      type: 'load',
      sourceId,
      source,
      resolveOptions,
    });
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
    this.workerFor(sourceId).postMessage({
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
    await Promise.all(
      [...this.workers.values()].map((worker) => worker.terminate()),
    );
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
