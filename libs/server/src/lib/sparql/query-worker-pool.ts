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

/** Default cooperative→nuclear cutover (`query.cancelGraceMs`, ADR-0050). A
 * cancelled query that doesn't tear down its stream within this window is
 * presumed stuck in a synchronous Comunica stretch and reclaimed by terminate. */
const DEFAULT_CANCEL_GRACE_MS = 250;

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
  /** Grace window before a cancelled-but-unresponsive worker is terminated
   * (`query.cancelGraceMs`, default 250ms). */
  cancelGraceMs?: number;
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
  /** Where cancels post, and which co-located queries the nuclear path fails. */
  workerIndex: number;
  /** Names the query in the typed error a terminated worker produces (ADR-0024). */
  query: string;
  /** Drops the abort listener on settle so a long-lived request signal (an open
   * HTTP connection) doesn't accumulate listeners. */
  detachAbort?: () => void;
  /** Cooperative→nuclear cutover timer; armed on cancel, cleared on settle. */
  graceTimer?: ReturnType<typeof setTimeout>;
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
 * and keeps the CPU-bound Comunica work off the main event loop. It also drives
 * hybrid cancellation: cooperative `cancel` first, then terminate + respawn if a
 * worker stays stuck past the grace window.
 */
export class QueryWorkerPool {
  private readonly spawn: () => QueryWorkerHandle;
  private readonly concurrency: number;
  private readonly assignment: AssignmentStrategy;
  private readonly cancelGraceMs: number;
  /** Workers materialized so far, keyed by assignment index. */
  private readonly workers = new Map<number, QueryWorkerHandle>();
  /** Sources routed to each worker index — the set whose stores a respawn drops,
   * so the front (EngineMap) can rebuild them on next touch. */
  private readonly sourcesByWorker = new Map<number, Set<string>>();
  private onWorkerReset: ((sourceIds: ReadonlyArray<string>) => void) | undefined;
  private readonly pending = new Map<number, PendingQuery>();
  /** In-flight loads keyed by source id — concurrent touches coalesce here. */
  private readonly loads = new Map<string, PendingLoad>();
  private nextRequestId = 1;

  constructor(options: QueryWorkerPoolOptions) {
    this.spawn = options.spawn;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.assignment =
      options.assignment ?? new HashStickyAssignment(this.concurrency);
    this.cancelGraceMs = options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;
  }

  /** Resolves the worker owning `sourceId`, spawning it on first use. The same
   * id always resolves to the same worker (stickiness rests on the strategy). */
  private workerFor(sourceId: string): QueryWorkerHandle {
    const index = this.assignment.assign(sourceId);
    let sources = this.sourcesByWorker.get(index);
    if (sources === undefined) {
      sources = new Set();
      this.sourcesByWorker.set(index, sources);
    }
    sources.add(sourceId);
    let worker = this.workers.get(index);
    if (worker === undefined) {
      worker = this.spawn();
      worker.on('message', (message) => this.onMessage(message));
      this.workers.set(index, worker);
    }
    return worker;
  }

  /** Registers the callback the pool fires when a worker is reclaimed (terminated
   * + respawned). It receives the sources that worker owned, whose stores are now
   * gone — the front rebuilds them lazily on the next touch (ADR-0050). */
  onReset(callback: (sourceIds: ReadonlyArray<string>) => void): void {
    this.onWorkerReset = callback;
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
    options: { format?: SparqlFormat; mutable?: boolean; signal?: AbortSignal },
  ): ResultAsync<ExecuteResult, QueryExecutionError | EndpointFetchError> {
    const requestId = this.nextRequestId++;
    const workerIndex = this.assignment.assign(sourceId);
    let pending!: PendingQuery;
    const settled = new Promise<
      Result<ExecuteResult, QueryExecutionError | EndpointFetchError>
    >((resolve) => {
      pending = { resolve, workerIndex, query };
      this.pending.set(requestId, pending);
    });
    this.workerFor(sourceId).postMessage({
      type: 'query',
      requestId,
      sourceId,
      query,
      format: options.format,
      mutable: options.mutable,
    });
    // Wired after the query is posted so the worker registers the request before
    // any cancel for it can arrive (the worker tolerates either ordering anyway).
    this.wireCancellation(requestId, pending, options.signal);
    return new ResultAsync(settled);
  }

  /** Bridges an `AbortSignal` (an HTTP client disconnect, ADR-0050) to the
   * worker: on abort, posts a cooperative `cancel` for the request. */
  private wireCancellation(
    requestId: number,
    pending: PendingQuery,
    signal: AbortSignal | undefined,
  ): void {
    if (signal === undefined) return;
    const onAbort = (): void => this.onCancel(requestId);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    pending.detachAbort = (): void =>
      signal.removeEventListener('abort', onAbort);
  }

  /** Cooperative cancel: ask the owning worker to tear down the query's stream,
   * and arm the grace timer that escalates to termination if it stays stuck. A
   * cancel for an already-settled request is a no-op. */
  private onCancel(requestId: number): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined || pending.graceTimer !== undefined) return;
    this.workers.get(pending.workerIndex)?.postMessage({
      type: 'cancel',
      requestId,
    });
    pending.graceTimer = setTimeout(
      () => this.terminateWorker(pending.workerIndex),
      this.cancelGraceMs,
    );
  }

  /** Nuclear path (ADR-0050): the worker is stuck in a synchronous stretch and
   * ignored the cancel. Terminate it, respawn at the same index, and fail every
   * query that was in flight on it. Idempotent if the worker is already replaced. */
  private terminateWorker(workerIndex: number): void {
    const worker = this.workers.get(workerIndex);
    if (worker === undefined) return;
    void worker.terminate();
    const replacement = this.spawn();
    replacement.on('message', (message) => this.onMessage(message));
    this.workers.set(workerIndex, replacement);
    for (const [requestId, pending] of [...this.pending]) {
      if (pending.workerIndex !== workerIndex) continue;
      this.pending.delete(requestId);
      this.settle(pending, err(this.terminatedError(pending.query)));
    }
    // The replacement starts empty — tell the front to rebuild these on next touch.
    const orphaned = this.sourcesByWorker.get(workerIndex);
    if (orphaned !== undefined && orphaned.size > 0) {
      this.onWorkerReset?.([...orphaned]);
    }
  }

  /** Resolves a pending query, first detaching its abort listener and disarming
   * its grace timer so nothing fires against the now-settled request. */
  private settle(
    pending: PendingQuery,
    result: Result<ExecuteResult, QueryExecutionError | EndpointFetchError>,
  ): void {
    if (pending.graceTimer !== undefined) clearTimeout(pending.graceTimer);
    pending.detachAbort?.();
    pending.resolve(result);
  }

  private terminatedError(query: string): QueryExecutionError {
    return {
      kind: 'query-execution',
      query,
      message: `query worker terminated after ${this.cancelGraceMs}ms cancel grace window`,
    };
  }

  async shutdown(): Promise<void> {
    for (const pending of this.pending.values()) {
      if (pending.graceTimer !== undefined) clearTimeout(pending.graceTimer);
    }
    await Promise.all(
      [...this.workers.values()].map((worker) => worker.terminate()),
    );
  }

  private onMessage(message: WorkerMessage): void {
    if (message.type === 'query-result') {
      const pending = this.pending.get(message.requestId);
      if (pending === undefined) return;
      this.pending.delete(message.requestId);
      this.settle(
        pending,
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
