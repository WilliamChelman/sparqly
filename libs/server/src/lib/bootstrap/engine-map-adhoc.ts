import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import type { SparqlyLogger } from 'common';
import {
  QueryEngine,
  resolveGlobPinShaResult,
  resolveSourceResult,
  resolveViewPinShaResult,
  storageTier,
  unionDefaultGraphEnabled,
  type GitPort,
  type ParsedGlobSource,
  type ParsedSource,
  type ParsedViewSource,
  type QueryExecutor,
  type RepoDiscoveryDeps,
  type SourceError,
} from 'core';
import { WorkerQueryExecutor } from '../sparql/query-worker-executor';
import type { QueryWorkerPool } from '../sparql/query-worker-pool';
import type { WorkerResolveOptions } from '../sparql/query-worker-protocol';

/** The slice of {@link EngineMap}'s state the ad-hoc resolver needs, passed as a
 * bag so the logic lives outside the (already large) EngineMap class. */
export interface AdHocDeps {
  pool: QueryWorkerPool | undefined;
  resolutionRegistry: ReadonlyArray<ParsedSource>;
  configDir: string;
  sparqlyVersion: string | undefined;
  indexCacheDir: string | undefined;
  logger: SparqlyLogger | undefined;
  gitPort: GitPort | undefined;
  repoDiscovery: RepoDiscoveryDeps | undefined;
  workerResolveOptions: WorkerResolveOptions;
}

/** Worker residency/routing key for an ad-hoc pinned source (#390): the source
 * `@id` joined to its resolved 40-char SHA, so two pins of the same id at
 * different commits route to (and reside under) distinct keys, and a floating
 * ref that has moved rebuilds rather than serving a stale resident store. */
export function adHocRouteId(id: string, sha: string): string {
  return `${id}@${sha}`;
}

/**
 * Resolves a {@link QueryExecutor} for an *ad-hoc pinned* source — a pin the
 * served registry doesn't carry (`@id:ref`), so it never gets a pre-built
 * EngineMap entry (#390). When a query worker is wired, an in-memory pinned glob
 * (keyed by its resolved SHA) or a pinned view (keyed by its leaf glob's SHA) is
 * routed through the pool: the worker builds and holds the store under
 * `${id}@${sha}`, so it runs off the main loop and resides apart from (and never
 * collides with) the unpinned `@id` variant. Anything the pool can't host — no
 * worker, an endpoint pass-through, or a disk-backed glob — falls back to the
 * legacy main-thread resolve+build.
 */
export function ensureAdHocExecutor(
  source: ParsedSource,
  deps: AdHocDeps,
): ResultAsync<QueryExecutor, SourceError> {
  const { pool } = deps;
  if (
    pool !== undefined &&
    source.kind === 'glob' &&
    source.gitRef !== undefined &&
    // Equivalent to `!isDiskBacked` for a glob; written as the storage check so
    // the predicate doesn't narrow the already-glob `source` to `never`.
    storageTier(source) !== 'disk'
  ) {
    const glob: ParsedGlobSource = source;
    return resolveGlobPinShaResult(glob, {
      configDir: deps.configDir,
      gitPort: deps.gitPort,
      repoDiscovery: deps.repoDiscovery,
      logger: deps.logger,
    }).andThen((sha) => {
      const routeId = adHocRouteId(glob.id as string, sha);
      return pool
        .ensureLoaded(glob, deps.workerResolveOptions, routeId)
        .map<QueryExecutor>(() => new WorkerQueryExecutor(pool, routeId));
    });
  }
  if (
    pool !== undefined &&
    source.kind === 'view' &&
    source.fromGitRef !== undefined
  ) {
    const view: ParsedViewSource = source;
    return resolveViewPinShaResult(view, deps.resolutionRegistry, {
      configDir: deps.configDir,
      gitPort: deps.gitPort,
      repoDiscovery: deps.repoDiscovery,
      logger: deps.logger,
    }).andThen<QueryExecutor, SourceError>((sha) => {
      // No leaf glob to pin (e.g. an endpoint-backed view) → keep the exact
      // legacy main-thread behavior instead of forcing it through the worker.
      if (sha === undefined) return resolveAdHocOnMain(view, deps);
      const routeId = adHocRouteId(view.id as string, sha);
      return pool
        .ensureLoaded(view, deps.workerResolveOptions, routeId)
        .map<QueryExecutor>(() => new WorkerQueryExecutor(pool, routeId));
    });
  }
  return resolveAdHocOnMain(source, deps);
}

// Legacy path: resolve and build the ad-hoc source's engine on the main loop.
// Used when no worker is wired, or for sources the worker can't host —
// endpoints (pass-through) and disk-backed globs (unsupported under serve).
function resolveAdHocOnMain(
  source: ParsedSource,
  deps: AdHocDeps,
): ResultAsync<QueryExecutor, SourceError> {
  return resolveSourceResult(source, {
    registry: deps.resolutionRegistry,
    logger: deps.logger,
    configDir: deps.configDir,
    sparqlyVersion: deps.sparqlyVersion,
    indexCacheDir: deps.indexCacheDir,
  }).andThen<QueryExecutor, SourceError>((sources) => {
    if (sources.mode === 'pass-through') {
      return okAsync(
        new QueryEngine(sources.endpoint, {
          id: source.id as string,
          mode: 'pass-through',
          logger: deps.logger,
        }),
      );
    }
    if (sources.mode === 'disk-backed') {
      // Release the LevelDB lock, then surface a typed glob-load error: serve
      // does not host disk-backed glob sources off the main thread.
      return ResultAsync.fromSafePromise(sources.close()).andThen(() =>
        errAsync<QueryExecutor, SourceError>({
          kind: 'glob-load',
          glob: source.kind === 'glob' ? [source.glob] : [],
          message:
            'serve does not yet support disk-backed glob sources (`storage: disk`); query them with `sparqly query`',
        }),
      );
    }
    return okAsync(
      new QueryEngine(
        sources.store,
        { id: source.id as string, mode: 'materialized', logger: deps.logger },
        { unionDefaultGraph: unionDefaultGraphEnabled(source) },
      ),
    );
  });
}
