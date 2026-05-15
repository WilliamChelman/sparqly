import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { DataFactory, Store, type Quad } from 'n3';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import type { SparqlyLogger } from 'common';
import { emitQueryEvent, loadRdfResult } from '../engine';
import { detectQueryType } from '../canonical/immutability';
import { applyTransformPipeline } from '../sources';
import {
  type ParsedEndpointSource,
  type ParsedSource,
  type ParsedViewSource,
} from '../sources';
import { GitCliPort } from '../sources/git/git-cli-port';
import type { GitPort } from '../sources/git/git-port';
import { defaultRepoDiscovery } from '../sources/git/pin-glob-source';
import type { RepoDiscoveryDeps } from '../sources/git/discover-repo';
import type {
  CacheIoError,
  EndpointFetchError,
  GitPinError,
  GlobLoadError,
  QueryExecutionError,
  ViewReferenceError,
  ViewValidationError,
} from '../sources/errors';
import {
  lookupResult as cacheLookupResult,
  storeViewResult as cacheStoreViewResult,
  type ViewCacheBinding,
} from './view-cache';
import {
  resolveViewPassThroughResult,
  type ViewQueryLogMeta,
} from './view-pass-through';
import { validateViewQueryResult } from './view-query-validate';
import {
  loadPinnedGlobUpstreamResult,
  type PinDeps,
} from './view-resolver-glob-pin';
import { propagateViewPin } from './propagate-view-pin';

export interface ResolveViewOptions {
  view: ParsedViewSource;
  registry: ReadonlyArray<ParsedSource>;
  /**
   * Absolute directory used for persistent caching of views that declare a
   * `cache` block. When omitted, the cache is skipped (lazy + process-lifetime
   * materialization only). Anonymous CLI views always omit this.
   */
  cacheDir?: string;
  /** Injectable clock; defaults to `Date.now`. */
  now?: () => number;
  /** Test seam: inject a Comunica engine. */
  engine?: ComunicaQueryEngine;
  /**
   * When set, each SPARQL execution along the `from:` chain emits a `query`
   * debug event (`mode=view`) on this logger — same shape as `sparqly query`
   * (ADR-0020).
   */
  logger?: SparqlyLogger;
  /**
   * Absolute path to the project config dir, used as the resolution root for
   * `gitRoot:` relative overrides when a view propagates a pin (ADR-0029,
   * #275). Defaults to `process.cwd()`.
   */
  configDir?: string;
  /**
   * Injectable git port used when the view's `from:` carries a `:<ref>` pin
   * (ADR-0029, #275). Defaults to the production `GitCliPort`.
   */
  gitPort?: GitPort;
  /**
   * Injectable repo-discovery deps used when the view's `from:` carries a
   * `:<ref>` pin (ADR-0029, #275). Defaults to a filesystem-backed impl.
   */
  repoDiscovery?: RepoDiscoveryDeps;
}

/**
 * Union of every variant a view resolution can produce. Each variant carries
 * structured fields per ADR-0024; the `view-reference` reason discriminates
 * between an unknown ref, a cycle on the `from:` DAG, and a reference-kind
 * upstream entry (which is an alias, not data).
 */
export type ResolveViewError =
  | ViewValidationError
  | ViewReferenceError
  | CacheIoError
  | EndpointFetchError
  | QueryExecutionError
  | GlobLoadError
  | GitPinError;

/**
 * Primary `Result`-typed view resolver. Returns the same `Store` payload as
 * the legacy `resolveView` on success, and a tagged {@link ResolveViewError}
 * on failure. The legacy `resolveView` is a thin throw-wrapping adapter that
 * preserves the historical message shape for downstream `legacy-message`
 * consumers until they migrate (ADR-0024).
 */
export function resolveViewResult(
  opts: ResolveViewOptions,
): ResultAsync<Store, ResolveViewError> {
  const pinDeps: PinDeps = {
    configDir: opts.configDir ?? process.cwd(),
    gitPort: opts.gitPort ?? new GitCliPort(),
    repoDiscovery: opts.repoDiscovery ?? defaultRepoDiscovery,
  };
  return resolveViewWithCacheResult(
    opts.view,
    opts.registry,
    [opts.view.id],
    opts.cacheDir,
    opts.now,
    opts.engine,
    opts.logger,
    pinDeps,
  );
}

/**
 * @deprecated Use {@link resolveViewResult} (ADR-0024). Retained as a thin
 * throw-based adapter for callers that have not migrated yet.
 */
export async function resolveView(opts: ResolveViewOptions): Promise<Store> {
  const result = await resolveViewResult(opts);
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
  return result.value;
}

function resolveViewWithCacheResult(
  view: ParsedViewSource,
  registry: ReadonlyArray<ParsedSource>,
  stack: ReadonlyArray<string>,
  cacheDir: string | undefined,
  now: (() => number) | undefined,
  engine: ComunicaQueryEngine | undefined,
  logger: SparqlyLogger | undefined,
  pinDeps: PinDeps,
): ResultAsync<Store, ResolveViewError> {
  if (view.fromGitRef !== undefined) {
    const propagation = propagateViewPin(view, view.fromGitRef, registry);
    if (propagation.isErr()) return errAsync(propagation.error);
  }
  if (!view.cache || !cacheDir) {
    return resolveViewInternal(view, registry, stack, cacheDir, now, engine, logger, pinDeps);
  }
  const upstream = collectCacheUpstream(view, registry);
  const binding: ViewCacheBinding = {
    view,
    upstream,
    cacheDir,
    now,
    registry,
    loadProbeStore:
      view.cache.strategy === 'freshness'
        ? () => loadUpstreamPromise(view, registry, stack, cacheDir, now, engine, logger, pinDeps)
        : undefined,
  };
  return cacheLookupResult(binding).andThen<Store, ResolveViewError>((hit) => {
    if (hit.freshness === 'fresh' && hit.store) {
      return okAsync(hit.store);
    }
    return resolveViewInternal(view, registry, stack, cacheDir, now, engine, logger, pinDeps).andThen(
      (fresh) => cacheStoreViewResult(binding, fresh).map(() => fresh),
    );
  });
}

/**
 * Bridges the cache freshness-ASK probe back to a `Promise<Store>` for the
 * binding contract. Throws to match the binding's existing shape; failures
 * surface as caught errors that get mapped by the cache layer.
 */
async function loadUpstreamPromise(
  view: ParsedViewSource,
  registry: ReadonlyArray<ParsedSource>,
  stack: ReadonlyArray<string>,
  cacheDir: string | undefined,
  now: (() => number) | undefined,
  engine: ComunicaQueryEngine | undefined,
  logger: SparqlyLogger | undefined,
  pinDeps: PinDeps,
): Promise<Store> {
  const result = await loadUpstreamResult(view, registry, stack, cacheDir, now, engine, logger, pinDeps);
  if (result.isErr()) throw new Error(result.error.message);
  return result.value;
}

function collectCacheUpstream(
  view: ParsedViewSource,
  registry: ReadonlyArray<ParsedSource>,
): ReadonlyArray<ParsedSource> {
  const byId = new Map<string, ParsedSource>();
  for (const src of registry) {
    if (src.kind === 'reference' || src.id === undefined) continue;
    byId.set(src.id, src);
  }
  const upstream = byId.get(view.from);
  return upstream ? [upstream] : [];
}

function resolveViewInternal(
  view: ParsedViewSource,
  registry: ReadonlyArray<ParsedSource>,
  stack: ReadonlyArray<string>,
  cacheDir: string | undefined,
  now: (() => number) | undefined,
  engine: ComunicaQueryEngine | undefined,
  logger: SparqlyLogger | undefined,
  pinDeps: PinDeps,
): ResultAsync<Store, ResolveViewError> {
  return loadViewQueryResult(view).andThen<Store, ResolveViewError>((query) =>
    validateViewQueryResult(query, { viewId: view.id })
      .map(() => query)
      .asyncAndThen<Store, ResolveViewError>((validQuery) => {
        const meta = { source: view.id, logger };
        const singleEndpoint = singleEndpointUpstream(view, registry);
        if (singleEndpoint) {
          return resolveViewPassThroughResult({
            endpoint: singleEndpoint,
            viewQuery: validQuery,
            engine,
            meta,
          });
        }
        return loadUpstreamResult(
          view,
          registry,
          stack,
          cacheDir,
          now,
          engine,
          logger,
          pinDeps,
        ).andThen((upstreamStore) =>
          runViewQueryResult(upstreamStore, validQuery, engine, meta),
        );
      }),
  );
}

function singleEndpointUpstream(
  view: ParsedViewSource,
  registry: ReadonlyArray<ParsedSource>,
): ParsedEndpointSource | undefined {
  const byId = buildRegistryById(registry);
  const upstream = byId.get(view.from);
  if (!upstream || upstream.kind !== 'endpoint') return undefined;
  return upstream;
}

function loadViewQueryResult(
  view: ParsedViewSource,
): ResultAsync<string, ViewValidationError> {
  if (view.query !== undefined) return okAsync(view.query);
  if (view.queryFile !== undefined) {
    const path = resolvePath(process.cwd(), view.queryFile);
    return ResultAsync.fromPromise(readFile(path, 'utf8'), (err) => ({
      kind: 'view-validation' as const,
      viewId: view.id,
      message: err instanceof Error ? err.message : String(err),
    }));
  }
  return errAsync({
    kind: 'view-validation',
    viewId: view.id,
    message: `exactly one of \`query\` or \`queryFile\` is required`,
  });
}

function loadUpstreamResult(
  view: ParsedViewSource,
  registry: ReadonlyArray<ParsedSource>,
  stack: ReadonlyArray<string>,
  cacheDir: string | undefined,
  now: (() => number) | undefined,
  engine: ComunicaQueryEngine | undefined,
  logger: SparqlyLogger | undefined,
  pinDeps: PinDeps,
): ResultAsync<Store, ResolveViewError> {
  const refId = view.from;
  const byId = buildRegistryById(registry);
  if (stack.includes(refId)) {
    return errAsync({
      kind: 'view-reference',
      viewId: view.id,
      ref: refId,
      reason: 'cycle',
      message: `cycle detected on \`from:\` ref @${refId} (chain: ${stack
        .map((id) => `@${id}`)
        .join(' -> ')} -> @${refId})`,
    });
  }
  const upstream = byId.get(refId);
  if (!upstream) {
    const known = [...byId.keys()];
    const list =
      known.length === 0 ? '<none>' : known.map((k) => `@${k}`).join(', ');
    return errAsync({
      kind: 'view-reference',
      viewId: view.id,
      ref: refId,
      reason: 'unknown',
      message: `unknown @id reference "@${refId}"; defined ids: ${list}`,
    });
  }
  if (upstream.kind === 'reference') {
    return errAsync({
      kind: 'view-reference',
      viewId: view.id,
      ref: refId,
      reason: 'reference-upstream',
      message: `reference upstream "@${refId}" is not yet supported`,
    });
  }
  if (upstream.kind === 'view') {
    const innerView: ParsedViewSource =
      view.fromGitRef !== undefined
        ? { ...upstream, fromGitRef: view.fromGitRef }
        : upstream;
    return resolveViewWithCacheResult(
      innerView,
      registry,
      [...stack, refId],
      cacheDir,
      now,
      engine,
      logger,
      pinDeps,
    );
  }
  if (upstream.kind === 'empty') {
    return okAsync(new Store());
  }
  if (upstream.kind === 'file') {
    return loadRdfResult({ sources: upstream.path, logger }).map((sub) =>
      applyTransformPipeline(sub.store, upstream.transforms ?? [], {
        perFileRecords: sub.perFileRecords,
      }),
    );
  }
  if (upstream.kind !== 'glob') {
    // Endpoint upstreams are routed via pass-through above; this branch is
    // unreachable for the current source kinds.
    return errAsync({
      kind: 'view-reference',
      viewId: view.id,
      ref: refId,
      reason: 'unknown',
      message: `unexpected upstream kind "${
        (upstream as { kind: string }).kind
      }" for ref @${refId}`,
    });
  }
  return loadPinnedGlobUpstreamResult(view, upstream, logger, pinDeps);
}

function buildRegistryById(
  registry: ReadonlyArray<ParsedSource>,
): Map<string, ParsedSource> {
  const map = new Map<string, ParsedSource>();
  for (const src of registry) {
    if (src.kind === 'reference') continue;
    if (src.id === undefined) continue;
    map.set(src.id, src);
  }
  return map;
}

function runViewQueryResult(
  source: Store,
  query: string,
  engine: ComunicaQueryEngine | undefined,
  meta: ViewQueryLogMeta,
): ResultAsync<Store, QueryExecutionError> {
  return ResultAsync.fromPromise(runViewQuery(source, query, engine, meta), (err) => ({
    kind: 'query-execution',
    query,
    message: err instanceof Error ? err.message : String(err),
  }));
}

async function runViewQuery(
  source: Store,
  query: string,
  engine: ComunicaQueryEngine | undefined,
  meta: ViewQueryLogMeta,
): Promise<Store> {
  const e = engine ?? new ComunicaQueryEngine();
  const out = new Store();
  const started = Date.now();
  const type = detectQueryType(query);
  try {
    const result = await e.query(query, { sources: [source] });
    if (result.resultType === 'bindings') {
      const bindings = await result.execute();
      for await (const b of bindings as AsyncIterable<{
        get(
          name: string,
        ): Quad['subject'] | Quad['predicate'] | Quad['object'] | undefined;
      }>) {
        const s = b.get('s');
        const p = b.get('p');
        const o = b.get('o');
        const g = b.get('g');
        if (!s || !p || !o) continue;
        const graph = g ? (g as Quad['graph']) : DataFactory.defaultGraph();
        out.addQuad(
          DataFactory.quad(
            s as Quad['subject'],
            p as Quad['predicate'],
            o as Quad['object'],
            graph,
          ),
        );
      }
    } else if (result.resultType === 'quads') {
      const quads = await result.execute();
      for await (const q of quads as AsyncIterable<Quad>) {
        out.addQuad(q);
      }
    } else {
      throw new Error(
        `view query produced unexpected result type: ${String(result.resultType)}`,
      );
    }
    emitQueryEvent(meta.logger, {
      source: meta.source,
      mode: 'view',
      query,
      type,
      ms: Date.now() - started,
      size: { quads: out.size },
    });
    return out;
  } catch (err) {
    emitQueryEvent(meta.logger, {
      source: meta.source,
      mode: 'view',
      query,
      type,
      ms: Date.now() - started,
      err,
    });
    throw err;
  }
}
