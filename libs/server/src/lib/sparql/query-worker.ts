import {
  QueryEngine,
  resolveSourceResult,
  unionDefaultGraphEnabled,
  type ParsedSource,
  type SourceError,
} from 'core';
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

interface ResidentStore {
  engine: QueryEngine;
  quads: number;
  files: ReadonlyArray<string>;
}

/**
 * ADR-0050 worker loop. Hosts an *unmodified* {@link QueryEngine}, builds and
 * owns the `n3.Store` for each in-memory source, memoizes it per source id, and
 * answers `load`/`query` RPCs over the port. All CPU-bound Comunica work runs
 * here, off the main event loop. Threading lives entirely on this side of the
 * port; `libs/core` stays thread-unaware.
 */
export function runQueryWorker(port: WorkerPort): void {
  const resident = new Map<string, ResidentStore>();

  port.on('message', (request) => {
    if (request.type === 'load') {
      void handleLoad(request);
    } else {
      void handleQuery(request);
    }
  });

  async function handleLoad(request: LoadRequest): Promise<void> {
    const { sourceId, source } = request;
    const existing = resident.get(sourceId);
    if (existing !== undefined) {
      // Already resident — re-loads (e.g. Reload) reply with current metrics.
      // Drop-and-rebuild invalidation reaching the worker is #391.
      port.postMessage(loadSuccess(sourceId, existing, 0));
      return;
    }
    const start = Date.now();
    const resolved = await resolveSourceResult(source, {
      registry: request.resolveOptions.resolutionRegistry,
      configDir: request.resolveOptions.configDir,
      sparqlyVersion: request.resolveOptions.sparqlyVersion,
      indexCacheDir: request.resolveOptions.indexCacheDir,
    });
    if (resolved.isErr()) {
      port.postMessage({ type: 'load-failure', sourceId, error: resolved.error });
      return;
    }
    const sources = resolved.value;
    if (sources.mode !== 'materialized') {
      // The pool only routes in-memory materialized sources here; anything else
      // is a wiring bug, surfaced as a typed error rather than a silent hang.
      port.postMessage({
        type: 'load-failure',
        sourceId,
        error: nonMaterializedError(source, sources.mode),
      });
      return;
    }
    const store = sources.store;
    const built: ResidentStore = {
      engine: new QueryEngine(
        store,
        { id: sourceId, mode: source.kind === 'view' ? 'view' : 'materialized' },
        { unionDefaultGraph: unionDefaultGraphEnabled(source) },
      ),
      quads: store.size,
      files: sources.files,
    };
    resident.set(sourceId, built);
    port.postMessage(loadSuccess(sourceId, built, Date.now() - start));
  }

  async function handleQuery(request: QueryRequest): Promise<void> {
    const { requestId, sourceId, query } = request;
    const memo = resident.get(sourceId);
    if (memo === undefined) {
      port.postMessage({
        type: 'query-result',
        requestId,
        error: {
          kind: 'query-execution',
          query,
          message: `worker has no resident store for '${sourceId}' — load first`,
        },
      });
      return;
    }
    const result = await memo.engine.executeResult(query, {
      format: request.format,
      mutable: request.mutable,
    });
    result.match(
      (ok) => port.postMessage({ type: 'query-result', requestId, ok }),
      (error) => port.postMessage({ type: 'query-result', requestId, error }),
    );
  }
}

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
