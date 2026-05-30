import { err, ok, type Result } from 'neverthrow';
import {
  formatSourceError,
  QueryEngine,
  resolveSourceResult,
  unionDefaultGraphEnabled,
  type ParsedSource,
  type QueryExecutionError,
  type QueryExecutor,
  type SourceError,
} from 'core';
import { ResidentSet } from './resident-set';
import type {
  LoadRequest,
  QueryRequest,
  WorkerMessage,
  WorkerRequest,
} from './query-worker-protocol';

/** The half of `parentPort` the worker loop drives — narrowed so the loop is
 * unit-testable with an in-process fake (no real thread). */
export interface WorkerPort {
  postMessage(message: WorkerMessage): void;
  on(event: 'message', listener: (message: WorkerRequest) => void): void;
}

/** A built, queryable store the worker holds resident under its LRU budget. */
export interface ResidentStore {
  engine: QueryExecutor;
  quads: number;
  files: ReadonlyArray<string>;
}

/** Turns a `load` recipe into a resident store. Injected so residency/eviction
 * tests drive deterministic fakes; production resolves + builds the real store. */
export type StoreBuilder = (
  request: LoadRequest,
) => Promise<Result<ResidentStore, SourceError>>;

/**
 * Default per-worker resident budget (ADR-0050). High enough that typical small
 * registries never evict — zero behavior change vs ADR-0031's process-lifetime
 * memoization — while still bounding a runaway registry under the
 * `resourceLimits` hard ceiling.
 */
export const DEFAULT_MAX_RESIDENT_QUADS = 50_000_000;

export interface RunQueryWorkerOptions {
  /** Per-worker LRU budget in quads (`query.maxResidentQuads`). */
  maxResidentQuads?: number;
  /** Override the store builder; defaults to the real resolve+`QueryEngine`. */
  buildStore?: StoreBuilder;
}

/**
 * ADR-0050 worker loop. Hosts an *unmodified* {@link QueryEngine}, builds and
 * owns the `n3.Store` for each in-memory source, and answers `load`/`query` RPCs
 * over the port. All CPU-bound Comunica work runs here, off the main event loop.
 *
 * Residency is **per-worker LRU-bounded** (amends ADR-0031): each built store is
 * held in a {@link ResidentSet} capped by `maxResidentQuads`, and the LRU idle
 * store is evicted when a new build pushes the worker over budget. The store of
 * an in-flight query is **pinned** and never evicted. Residency and routing stay
 * orthogonal — the worker keeps each source's lightweight build *recipe* across
 * eviction, so a query for an evicted source rebuilds it transparently rather
 * than relying on the main thread to re-send a `load`.
 */
export function runQueryWorker(
  port: WorkerPort,
  options: RunQueryWorkerOptions = {},
): void {
  const resident = new ResidentSet<ResidentStore>(
    options.maxResidentQuads ?? DEFAULT_MAX_RESIDENT_QUADS,
  );
  const buildStore = options.buildStore ?? defaultBuildStore;
  // The recipe outlives the built store: an evicted source rebuilds from here.
  const recipes = new Map<string, LoadRequest>();

  port.on('message', (request) => {
    if (request.type === 'load') {
      void handleLoad(request);
    } else {
      void handleQuery(request);
    }
  });

  async function handleLoad(request: LoadRequest): Promise<void> {
    const { sourceId } = request;
    recipes.set(sourceId, request);
    const existing = resident.get(sourceId);
    if (existing !== undefined) {
      // Already resident — re-loads (e.g. Reload) reply with current metrics.
      // Drop-and-rebuild invalidation reaching the worker is #391.
      port.postMessage(loadSuccess(sourceId, existing, 0));
      return;
    }
    const start = Date.now();
    const built = await buildStore(request);
    if (built.isErr()) {
      port.postMessage({ type: 'load-failure', sourceId, error: built.error });
      return;
    }
    resident.set(sourceId, built.value);
    port.postMessage(loadSuccess(sourceId, built.value, Date.now() - start));
  }

  async function handleQuery(request: QueryRequest): Promise<void> {
    const { requestId, sourceId, query } = request;
    const resolved = await ensureResident(request);
    if (resolved.isErr()) {
      port.postMessage({ type: 'query-result', requestId, error: resolved.error });
      return;
    }
    // Pin for the lifetime of the query so a concurrent over-budget load on this
    // worker can never evict the store this query is reading.
    resident.pin(sourceId);
    try {
      const result = await resolved.value.engine.executeResult(query, {
        format: request.format,
        mutable: request.mutable,
      });
      result.match(
        (ok) => port.postMessage({ type: 'query-result', requestId, ok }),
        (error) => port.postMessage({ type: 'query-result', requestId, error }),
      );
    } finally {
      resident.unpin(sourceId);
    }
  }

  /** Resolves the store for `sourceId`, rebuilding it from the retained recipe
   * if it was evicted. Surfaces a typed query-execution error when the source
   * was never loaded or its rebuild fails. */
  async function ensureResident(
    request: QueryRequest,
  ): Promise<Result<ResidentStore, QueryExecutionError>> {
    const { sourceId, query } = request;
    const existing = resident.get(sourceId);
    if (existing !== undefined) return ok(existing);
    const recipe = recipes.get(sourceId);
    if (recipe === undefined) {
      return err({
        kind: 'query-execution',
        query,
        message: `worker has no resident store for '${sourceId}' — load first`,
      });
    }
    const built = await buildStore(recipe);
    if (built.isErr()) {
      return err({
        kind: 'query-execution',
        query,
        message: `failed to rebuild evicted store '${sourceId}': ${formatSourceError(built.error)}`,
      });
    }
    resident.set(sourceId, built.value);
    return ok(built.value);
  }
}

/** Production builder: resolve the source on this thread and wrap its store in
 * an unmodified {@link QueryEngine}. Parsing therefore also leaves the main loop. */
const defaultBuildStore: StoreBuilder = async (request) => {
  const { source } = request;
  const resolved = await resolveSourceResult(source, {
    registry: request.resolveOptions.resolutionRegistry,
    configDir: request.resolveOptions.configDir,
    sparqlyVersion: request.resolveOptions.sparqlyVersion,
    indexCacheDir: request.resolveOptions.indexCacheDir,
  });
  if (resolved.isErr()) return err(resolved.error);
  const sources = resolved.value;
  if (sources.mode !== 'materialized') {
    // The pool only routes in-memory materialized sources here; anything else
    // is a wiring bug, surfaced as a typed error rather than a silent hang.
    return err(nonMaterializedError(source, sources.mode));
  }
  const store = sources.store;
  return ok({
    engine: new QueryEngine(
      store,
      {
        id: source.id as string,
        mode: source.kind === 'view' ? 'view' : 'materialized',
      },
      { unionDefaultGraph: unionDefaultGraphEnabled(source) },
    ),
    quads: store.size,
    files: sources.files,
  });
};

function loadSuccess(
  sourceId: string,
  store: ResidentStore,
  loadMs: number,
): WorkerMessage {
  return {
    type: 'load-success',
    sourceId,
    quads: store.quads,
    loadMs,
    files: store.files,
  };
}

function nonMaterializedError(source: ParsedSource, mode: string): SourceError {
  return {
    kind: 'glob-load',
    glob: source.kind === 'glob' ? [source.glob] : [],
    message: `query worker received a non-materialized source (mode: ${mode})`,
  };
}
