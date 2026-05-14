import { sep } from 'node:path';
import * as chokidar from 'chokidar';
import { Logger } from '@nestjs/common';
import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { Store } from 'n3';
import type { SparqlyLogger } from 'common';
import {
  type GraphMode,
  type ParsedSource,
  type ParsedViewSource,
  resolveSource,
} from 'core';
import type { EngineMap } from './engine-map';
import type { MetaChildrenCache } from './meta-children-cache';
import type { SnippetAllowList } from '../snippet';
import type { StoreRef } from './tokens';
import {
  buildWatcherChain,
  type WatcherChain,
  type WatcherSourcePlan,
} from './watcher-chain';

export interface WatcherHandle {
  close: () => Promise<void>;
}

type RefreshTrigger =
  | { kind: 'file-change'; path: string }
  | { kind: 'ttl'; viewId: string }
  | { kind: 'freshness'; viewId: string };

export interface MaybeStartWatcherOptions {
  /** Sources `serve` exposes — the ones we try to watch. */
  servedRegistry: ReadonlyArray<ParsedSource>;
  /** Superset used to walk `from:` chains (e.g. a scoped `@view`'s upstreams). */
  resolutionRegistry: ReadonlyArray<ParsedSource>;
  engineMap: EngineMap;
  graphMode?: GraphMode;
  /** NestJS logger — used for the `--watch:` skip warnings. */
  logger: Logger;
  /** Boundary logger (ADR-0020) — carries the rebuild/freshness timing lines. */
  boundaryLogger: SparqlyLogger;
  debounceMs: number;
  pollMs: number;
  snippetAllowList: SnippetAllowList;
  /**
   * Per-meta children cache for `splitByFile: true` globs (ADR-0027). The
   * watcher calls `invalidate(parentId)` on add/unlink events inside a
   * split-glob's pattern so the next `/api/config` re-walks the meta.
   */
  metaChildrenCache: MetaChildrenCache;
}

export async function maybeStartWatcher(
  opts: MaybeStartWatcherOptions,
): Promise<WatcherHandle | undefined> {
  const chain = buildWatcherChain(opts.servedRegistry, opts.resolutionRegistry);

  for (const skipped of chain.passThrough) {
    const id = (skipped as { id?: string }).id;
    if (id === undefined) continue;
    if (skipped.kind === 'endpoint') {
      opts.logger.warn(
        `--watch: skipping @${id}; endpoint sources are not auto-refreshed.`,
      );
    } else {
      opts.logger.warn(
        `--watch: skipping @${id}; chain has no glob source and no \`cache.ttl\`/\`cache.freshness\` views to refresh.`,
      );
    }
  }

  const targets: WatchedSource[] = [];
  for (const plan of chain.sources) {
    if (plan.id === undefined) continue;
    const storeRef = opts.engineMap.getStoreRef(plan.id);
    if (!storeRef) {
      opts.logger.warn(
        `--watch: skipping @${plan.id}; resolves pass-through to an endpoint.`,
      );
      continue;
    }
    const sourceId = plan.id;
    targets.push({
      plan,
      storeRef,
      target: plan.source,
      registry: opts.resolutionRegistry,
      onRebuiltFiles: (files) => {
        opts.engineMap.setFiles(sourceId, files);
        opts.snippetAllowList.update(opts.engineMap.allFiles());
      },
    });
  }

  if (targets.length === 0) {
    opts.logger.warn(
      '--watch: nothing to refresh — no glob source in any served chain and no `cache.ttl`/`cache.freshness` views. SPARQL endpoints are not auto-refreshed; restart the process to pick up upstream changes.',
    );
    return undefined;
  }

  return startMultiSourceWatcher(targets, chain, {
    graphMode: opts.graphMode,
    boundaryLogger: opts.boundaryLogger,
    debounceMs: opts.debounceMs,
    pollMs: opts.pollMs,
    metaChildrenCache: opts.metaChildrenCache,
  });
}

interface WatchedSource {
  plan: WatcherSourcePlan;
  storeRef: StoreRef;
  target: ParsedSource;
  registry: ReadonlyArray<ParsedSource>;
  /**
   * Notification fired after every successful materialized rebuild with the
   * absolute paths the loader actually opened on this rebuild. Used to keep
   * the snippet allow-list in sync with the resolution result so that newly
   * matched files become readable and removed files stop being readable.
   */
  onRebuiltFiles?: (files: ReadonlyArray<string>) => void;
}

interface MultiSourceWatcherDeps {
  graphMode?: GraphMode;
  boundaryLogger: SparqlyLogger;
  debounceMs: number;
  pollMs: number;
  metaChildrenCache: MetaChildrenCache;
}

async function startMultiSourceWatcher(
  targets: ReadonlyArray<WatchedSource>,
  chain: WatcherChain,
  deps: MultiSourceWatcherDeps,
): Promise<WatcherHandle> {
  let watcher: chokidar.FSWatcher | undefined;
  if (chain.globBases.length > 0) {
    watcher = chokidar.watch([...chain.globBases], {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
    });
    await new Promise<void>((resolveReady, rejectReady) => {
      const w = watcher as chokidar.FSWatcher;
      const onReady = (): void => {
        w.off('error', onError);
        resolveReady();
      };
      const onError = (err: unknown): void => {
        w.off('ready', onReady);
        rejectReady(err instanceof Error ? err : new Error(String(err)));
      };
      w.once('ready', onReady);
      w.once('error', onError);
    });
  }

  const sourceRunners = new Map<WatchedSource, SourceRunner>();
  for (const t of targets) {
    sourceRunners.set(t, createSourceRunner(t, deps));
  }

  const onFileEvent = (
    path: string,
    setChanged: boolean,
  ): void => {
    for (const [t, runner] of sourceRunners) {
      if (!pathBelongsToPlan(path, t.plan)) continue;
      if (setChanged && isSplitGlobMeta(t.target)) {
        const parentId = t.plan.id;
        if (parentId !== undefined && deps.metaChildrenCache.hasParent(parentId)) {
          deps.metaChildrenCache.invalidate(parentId);
          deps.boundaryLogger.info('split-children-invalidated', {
            parentId,
            path,
          });
        }
      }
      runner.schedule({ kind: 'file-change', path });
    }
  };

  if (watcher) {
    watcher.on('add', (p) => onFileEvent(p, true));
    watcher.on('change', (p) => onFileEvent(p, false));
    watcher.on('unlink', (p) => onFileEvent(p, true));
  }

  // Per-source TTL + freshness handles.
  const ttlHandles: ScheduledHandle[] = [];
  const freshnessHandles: ScheduledHandle[] = [];
  for (const t of targets) {
    const runner = sourceRunners.get(t);
    if (!runner) continue;
    ttlHandles.push(startTtlTimers(t.plan.cachedViews, runner.schedule));
    freshnessHandles.push(
      startFreshnessPolls(
        t.plan.cachedViews,
        t.plan.chain,
        deps.pollMs,
        deps.boundaryLogger,
        runner.schedule,
      ),
    );
  }

  return {
    close: async () => {
      for (const runner of sourceRunners.values()) runner.dispose();
      for (const h of ttlHandles) h.stop();
      for (const h of freshnessHandles) h.stop();
      if (watcher) await watcher.close();
    },
  };
}

interface SourceRunner {
  schedule: (trigger: RefreshTrigger) => void;
  dispose: () => void;
}

function createSourceRunner(
  target: WatchedSource,
  deps: MultiSourceWatcherDeps,
): SourceRunner {
  const inChainViewIds = target.plan.views.map((v) => v.id);
  const sourceField: { source?: string } =
    target.plan.id !== undefined ? { source: target.plan.id } : {};

  let pending: NodeJS.Timeout | undefined;
  let inFlight = false;
  let queued: RefreshTrigger | undefined;

  const rebuild = async (trigger: RefreshTrigger): Promise<void> => {
    if (inFlight) {
      queued = trigger;
      return;
    }
    inFlight = true;
    try {
      const refreshedIds =
        trigger.kind === 'file-change' ? inChainViewIds : [trigger.viewId];
      for (const id of refreshedIds) {
        deps.boundaryLogger.info('view-refreshing', {
          ...sourceField,
          view: id,
          trigger: trigger.kind,
        });
      }
      const start = Date.now();
      const refreshed = await resolveSource(target.target, {
        graphMode: deps.graphMode,
        registry: target.registry,
        logger: deps.boundaryLogger,
      });
      if (refreshed.mode === 'materialized') {
        target.storeRef.current = refreshed.store;
        target.onRebuiltFiles?.(refreshed.files);
        deps.boundaryLogger.info('view-rebuilt', {
          ...sourceField,
          files: refreshed.files.length,
          quads: refreshed.store.size,
          ms: Date.now() - start,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.boundaryLogger.error('view-rebuild-failed', {
        ...sourceField,
        error: message,
      });
    } finally {
      inFlight = false;
      const next = queued;
      if (next) {
        queued = undefined;
        void rebuild(next);
      }
    }
  };

  const schedule = (trigger: RefreshTrigger): void => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = undefined;
      void rebuild(trigger);
    }, deps.debounceMs);
  };

  return {
    schedule,
    dispose: () => {
      if (pending) {
        clearTimeout(pending);
        pending = undefined;
      }
    },
  };
}

function isSplitGlobMeta(src: ParsedSource): boolean {
  return src.kind === 'glob' && src.splitByFile === true;
}

function pathBelongsToPlan(
  path: string,
  plan: WatcherSourcePlan,
): boolean {
  for (const base of plan.globBases) {
    if (path === base) return true;
    if (path.startsWith(base + sep)) return true;
    if (sep !== '/' && path.startsWith(base + '/')) return true;
  }
  return false;
}

interface ScheduledHandle {
  stop: () => void;
}

function startTtlTimers(
  views: ReadonlyArray<ParsedViewSource>,
  schedule: (trigger: RefreshTrigger) => void,
): ScheduledHandle {
  const timers: NodeJS.Timeout[] = [];
  for (const view of views) {
    if (view.cache?.strategy !== 'ttl') continue;
    const ttlMs = view.cache.ttlMs;
    const tick = (): void => {
      schedule({ kind: 'ttl', viewId: view.id });
    };
    const t = setInterval(tick, ttlMs);
    timers.push(t);
  }
  return {
    stop: () => {
      for (const t of timers) clearInterval(t);
    },
  };
}

function startFreshnessPolls(
  views: ReadonlyArray<ParsedViewSource>,
  registry: ReadonlyArray<ParsedSource>,
  pollMs: number,
  boundaryLogger: SparqlyLogger,
  schedule: (trigger: RefreshTrigger) => void,
): ScheduledHandle {
  const timers: NodeJS.Timeout[] = [];
  for (const view of views) {
    if (view.cache?.strategy !== 'freshness') continue;
    const askQuery = view.cache.freshness;
    let lastResult = true;
    const probe = async (): Promise<void> => {
      const start = Date.now();
      try {
        const result = await runAskAgainstUpstream(view, registry, askQuery);
        boundaryLogger.debug('freshness-probe', {
          view: view.id,
          upstream: view.from,
          fresh: result,
          ms: Date.now() - start,
        });
        if (lastResult && !result) {
          schedule({ kind: 'freshness', viewId: view.id });
        }
        lastResult = result;
      } catch (err) {
        boundaryLogger.error('freshness-probe-failed', {
          view: view.id,
          upstream: view.from,
          error: err instanceof Error ? err.message : String(err),
          ms: Date.now() - start,
        });
      }
    };
    const t = setInterval(() => void probe(), pollMs);
    timers.push(t);
  }
  return {
    stop: () => {
      for (const t of timers) clearInterval(t);
    },
  };
}

async function runAskAgainstUpstream(
  view: ParsedViewSource,
  registry: ReadonlyArray<ParsedSource>,
  askQuery: string,
): Promise<boolean> {
  const byId = new Map<string, ParsedSource>();
  for (const src of registry) {
    if (src.kind === 'reference' || src.id === undefined) continue;
    byId.set(src.id, src);
  }
  const upstream = byId.get(view.from);
  if (!upstream) {
    throw new Error(
      `freshness watch: view "${view.id}" upstream "@${view.from}" is missing from the registry`,
    );
  }
  if (upstream.kind !== 'endpoint' && upstream.kind !== 'empty') {
    throw new Error(
      `freshness watch supports endpoint or empty upstreams; view "${view.id}" upstream is ${upstream.kind}`,
    );
  }
  const engine = new ComunicaQueryEngine();
  const source =
    upstream.kind === 'endpoint'
      ? { type: 'sparql', value: upstream.endpoint }
      : new Store();
  const result = await engine.query(askQuery, { sources: [source] });
  if (result.resultType !== 'boolean') {
    throw new Error(
      `cache.freshness query must be an ASK; got ${String(result.resultType)}`,
    );
  }
  return (await result.execute()) as boolean;
}
