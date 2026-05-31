import { sep } from 'node:path';
import * as chokidar from 'chokidar';
import { Logger } from '@nestjs/common';
import type { SparqlyLogger } from 'common';
import {
  formatSourceError,
  type GraphMode,
  type ParsedSource,
  resolveSourceResult,
  walkGlobPaths,
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

type RefreshTrigger = { kind: 'file-change'; path: string };

export interface MaybeStartWatcherOptions {
  /** Sources `serve` exposes — the ones we try to watch. */
  servedRegistry: ReadonlyArray<ParsedSource>;
  engineMap: EngineMap;
  graphMode?: GraphMode;
  /** NestJS logger — used for the `--watch:` skip warnings. */
  logger: Logger;
  /** Boundary logger (ADR-0020) — carries the rebuild timing lines. */
  boundaryLogger: SparqlyLogger;
  debounceMs: number;
  snippetAllowList: SnippetAllowList;
  /**
   * Cheap glob walkers (no parse, no Store build) used to keep the snippet
   * allow-list in sync on FS changes — even for lazy (never-queried) or
   * worker-owned sources whose store is never rebuilt on the main thread
   * (#391). Mirror the boot-time seeding in `create-server`.
   */
  walkGlob: Parameters<typeof walkGlobPaths>[1]['walkGlob'];
  walkGitGlob: Parameters<typeof walkGlobPaths>[1]['walkGitGlob'];
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
  const chain = buildWatcherChain(opts.servedRegistry);

  for (const skipped of chain.passThrough) {
    const id = (skipped as { id?: string }).id;
    if (id === undefined) continue;
    if (skipped.kind === 'endpoint') {
      opts.logger.warn(
        `--watch: skipping @${id}; endpoint sources are not auto-refreshed.`,
      );
    } else {
      opts.logger.warn(
        `--watch: skipping @${id}; source has no glob/file to watch.`,
      );
    }
  }

  const targets: WatchedSource[] = [];
  for (const plan of chain.sources) {
    if (plan.id === undefined) continue;
    const sourceId = plan.id;
    const source = plan.source;
    targets.push({
      plan,
      engineMap: opts.engineMap,
      target: source,
      onRebuiltFiles: (files) => {
        opts.engineMap.setFiles(sourceId, files);
        opts.snippetAllowList.update(opts.engineMap.allFiles());
      },
      // Only glob sources can gain/lose matched files; a `file:` source's path
      // is fixed. Enumerate without parsing so the refresh stays cheap (#391).
      resolveAllowListFiles:
        source.kind === 'glob'
          ? () =>
              walkGlobPaths(source, {
                walkGlob: opts.walkGlob,
                walkGitGlob: opts.walkGitGlob,
              })
          : undefined,
    });
  }

  if (targets.length === 0) {
    opts.logger.warn(
      '--watch: nothing to refresh — no glob source to watch. SPARQL endpoints are not auto-refreshed; restart the process to pick up upstream changes.',
    );
    return undefined;
  }

  return startMultiSourceWatcher(targets, chain, {
    graphMode: opts.graphMode,
    boundaryLogger: opts.boundaryLogger,
    debounceMs: opts.debounceMs,
    metaChildrenCache: opts.metaChildrenCache,
  });
}

interface WatchedSource {
  plan: WatcherSourcePlan;
  /**
   * ADR-0031: storeRef lookup is deferred to event time. An un-touched source
   * has no storeRef yet — the runner short-circuits the rebuild for it so a
   * chokidar event does not subvert laziness.
   *
   * ADR-0050 (#391): a worker-owned in-memory store has no main-thread storeRef.
   * `invalidate(id)` drops its resident copy on the owning worker (a no-op, and
   * `false`, for a non-worker or un-touched source) so the same laziness holds —
   * `false` falls through to the legacy storeRef path below.
   */
  engineMap: {
    getStoreRef: (id: string) => StoreRef | undefined;
    invalidate: (id: string) => boolean;
  };
  target: ParsedSource;
  /**
   * Notification fired after every successful materialized rebuild with the
   * absolute paths the loader actually opened on this rebuild. Used to keep
   * the snippet allow-list in sync with the resolution result so that newly
   * matched files become readable and removed files stop being readable.
   */
  onRebuiltFiles?: (files: ReadonlyArray<string>) => void;
  /**
   * Cheap glob enumeration (no parse) for this source, when it is a glob.
   * Drives the eager snippet allow-list refresh on FS changes regardless of
   * whether the store is rebuilt on main — for lazy or worker-owned sources
   * the legacy main-thread rebuild below never runs, so this is the only path
   * that lets a newly-matched file become readable (#391).
   */
  resolveAllowListFiles?: () => Promise<ReadonlyArray<string>>;
}

interface MultiSourceWatcherDeps {
  graphMode?: GraphMode;
  boundaryLogger: SparqlyLogger;
  debounceMs: number;
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
      // Watcher gate (ADR-0029): a pinned glob's content + enumeration are
      // frozen to the git tree at the resolved SHA, so working-tree events
      // never bust its cache. Skip both child-cache invalidation and the
      // source-runner rebuild for pinned sources.
      if (isPinnedGlob(t.target)) continue;
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

  return {
    close: async () => {
      for (const runner of sourceRunners.values()) runner.dispose();
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
  const sourceField: { source?: string } =
    target.plan.id !== undefined ? { source: target.plan.id } : {};

  let pending: NodeJS.Timeout | undefined;
  let inFlight = false;
  let queued: RefreshTrigger | undefined;
  // Set by dispose() (on server close). Guards every observable side effect so
  // a rebuild that is already in-flight or queued when the watcher tears down
  // cannot emit `source-rebuilt` or mutate a storeRef after close — teardown is
  // deterministic, not best-effort.
  let disposed = false;

  const rebuild = async (trigger: RefreshTrigger): Promise<void> => {
    if (disposed) return;
    if (inFlight) {
      queued = trigger;
      return;
    }
    inFlight = true;
    try {
      if (disposed) return;
      const planId = target.plan.id;
      // #391: the snippet allow-list is eager main-owned machinery, orthogonal
      // to store residency. Re-walk the glob (no parse, no Store build) on every
      // FS change so a newly-matched file becomes readable via
      // `/api/source-snippet` — and a removed one stops being — even when the
      // store is lazy (never queried) or worker-owned and the legacy
      // main-thread rebuild below never runs.
      if (
        trigger.kind === 'file-change' &&
        target.resolveAllowListFiles &&
        target.onRebuiltFiles
      ) {
        const files = await target.resolveAllowListFiles();
        if (disposed) return;
        target.onRebuiltFiles(files);
      }
      // ADR-0050 (#391): a worker owns this source's store. Drop its resident
      // copy so the *next* query rebuilds it from disk — main does no rebuild
      // here. `invalidate` returns false (and falls through) when the source is
      // non-worker or un-touched, preserving the ADR-0031 laziness below.
      if (planId !== undefined && target.engineMap.invalidate(planId)) {
        deps.boundaryLogger.info('source-invalidated', {
          ...sourceField,
          trigger: trigger.kind,
        });
        return;
      }
      // ADR-0031: un-touched sources have no live storeRef. Don't load on
      // their behalf in response to FS events — the next
      // `ensure(id)` from a request will build the store fresh.
      const storeRef =
        planId !== undefined
          ? target.engineMap.getStoreRef(planId)
          : undefined;
      if (!storeRef) return;
      const start = Date.now();
      const refreshed = await resolveSourceResult(target.target, {
        graphMode: deps.graphMode,
        logger: deps.boundaryLogger,
      });
      if (disposed) return;
      refreshed.match(
        (sources) => {
          if (sources.mode !== 'materialized') return;
          storeRef.current = sources.store;
          target.onRebuiltFiles?.(sources.files);
          deps.boundaryLogger.info('source-rebuilt', {
            ...sourceField,
            files: sources.files.length,
            quads: sources.store.size,
            ms: Date.now() - start,
          });
        },
        (error) => {
          // ADR-0024: source resolution now returns a typed Result. Preserve the
          // existing swallow-and-log behavior — an FS-triggered rebuild failure
          // must not throw out of the watcher.
          deps.boundaryLogger.error('view-rebuild-failed', {
            ...sourceField,
            error: formatSourceError(error),
          });
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.boundaryLogger.error('view-rebuild-failed', {
        ...sourceField,
        error: message,
      });
    } finally {
      inFlight = false;
      const next = queued;
      if (next && !disposed) {
        queued = undefined;
        void rebuild(next);
      }
    }
  };

  const schedule = (trigger: RefreshTrigger): void => {
    if (disposed) return;
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = undefined;
      void rebuild(trigger);
    }, deps.debounceMs);
  };

  return {
    schedule,
    dispose: () => {
      disposed = true;
      queued = undefined;
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

function isPinnedGlob(src: ParsedSource): boolean {
  return src.kind === 'glob' && src.gitRef !== undefined;
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

