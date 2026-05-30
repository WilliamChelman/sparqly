import type {
  EndpointFetchError,
  ExecuteResult,
  ParsedSource,
  QueryExecutionError,
  SourceError,
  SparqlFormat,
} from 'core';

/**
 * Wire protocol for the in-memory query worker (ADR-0050). Every payload
 * crosses the `MessagePort` via structured clone, so all fields are plain
 * serializable data — no functions, no `n3.Store`, no class instances.
 */

/** Resolve inputs the worker needs to build a source's store on its own thread.
 * A serializable projection of `EngineMap`'s resolve options — the logger is
 * dropped (not cloneable); the worker logs to its own boundary. */
export interface WorkerResolveOptions {
  resolutionRegistry: ReadonlyArray<ParsedSource>;
  configDir: string;
  sparqlyVersion: string | undefined;
  indexCacheDir: string | undefined;
}

/** main → worker: build and memoize the source's store (idempotent per id). */
export interface LoadRequest {
  type: 'load';
  sourceId: string;
  source: ParsedSource;
  resolveOptions: WorkerResolveOptions;
}

/** main → worker: run a query against an already-resident store. */
export interface QueryRequest {
  type: 'query';
  requestId: number;
  sourceId: string;
  query: string;
  format: SparqlFormat | undefined;
  mutable: boolean | undefined;
}

/** main → worker: cancel an in-flight query by destroying its stream (ADR-0050).
 * Unknown or already-settled `requestId`s are a no-op. */
export interface CancelRequest {
  type: 'cancel';
  requestId: number;
}

/** main → worker: drop the resident store for `sourceId` so the next query
 * rebuilds it from the retained recipe (ADR-0050, #391). The build *recipe*
 * survives, so a `--watch` edit / Reload / Unload need not re-send a `load`:
 * the worker re-resolves the source from disk on the next query, picking up the
 * new content. Unknown or non-resident ids are a no-op. */
export interface InvalidateRequest {
  type: 'invalidate';
  sourceId: string;
}

export type WorkerRequest =
  | LoadRequest
  | QueryRequest
  | CancelRequest
  | InvalidateRequest;

/** worker → main: the store finished building — carries the metrics the
 * Sources-page state mirror surfaces in `/api/sources`. */
export interface LoadSuccessMessage {
  type: 'load-success';
  sourceId: string;
  quads: number;
  loadMs: number;
  /** Resolved file paths backing the store — feeds the `/api/sources` file
   * count and the snippet allow-list, and primes the FS watcher (#391). */
  files: ReadonlyArray<string>;
}

/** worker → main: the store failed to build; `error` keeps its original
 * `SourceError` kind so the HTTP boundary maps the right status. */
export interface LoadFailureMessage {
  type: 'load-failure';
  sourceId: string;
  error: SourceError;
}

/** worker → main: a query settled. Exactly one of `ok`/`error` is present. */
export interface QueryResultMessage {
  type: 'query-result';
  requestId: number;
  ok?: ExecuteResult;
  error?: QueryExecutionError | EndpointFetchError;
}

export type WorkerMessage =
  | LoadSuccessMessage
  | LoadFailureMessage
  | QueryResultMessage;

/**
 * The slice of `node:worker_threads.Worker` the pool drives. Injected through
 * the pool's `spawn` seam so tests pass an in-process fake — mirroring how
 * {@link IndexBuildPool} takes a `BuildChild` stand-in.
 */
export interface QueryWorkerHandle {
  postMessage(message: WorkerRequest): void;
  on(event: 'message', listener: (message: WorkerMessage) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  terminate(): Promise<number>;
}
