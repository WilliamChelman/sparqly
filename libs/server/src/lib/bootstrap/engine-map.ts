import { err, ok, ResultAsync, type Result } from 'neverthrow';
import type { SparqlyLogger } from 'common';
import {
  diskBackedIndexIdentity,
  formatSourceError,
  globIndexDir,
  QueryEngine,
  resolveSourceResult,
  sweepGlobIndexTempDirs,
  unionDefaultGraphEnabled,
  type ParsedSource,
  type SourceError,
} from 'core';
import type { StoreRef } from './tokens';
import { isDiskBacked, manifestExists } from './disk-backed-index';
import { reloadEntry, unloadEntry } from './engine-map-actions';
import { projectEntryState, reconcileStaleDedup } from './engine-map-read-state';
import {
  indexingError,
  spawnIndexBuildUnavailable,
  type Entry,
  type IndexingError,
  type LoadedEntry,
  type LoadedSources,
} from './engine-map-types';
import { IndexBuildPool, type SpawnIndexBuild } from './index-build-pool';
import type { SourceRuntime } from '../sources/source-row-projector';
import type { SourceStateEmitter } from '../sources/source-state-emitter';

export type { IndexingError, LoadedSources } from './engine-map-types';
export { isIndexingError } from './engine-map-types';

export interface EngineMapOptions {
  /**
   * Registry used to resolve `from:` chains while building engines — a superset
   * of the served set. Defaults to the served registry when omitted.
   */
  resolutionRegistry?: ReadonlyArray<ParsedSource>;
  /**
   * Boundary logger threaded into each source's {@link QueryEngine} (and into
   * `resolveSourceResult` for view chains) so `serve`'s SPARQL executions emit
   * the shared `query` debug event under `--verbose` (ADR-0020). Also emits a
   * `source-loaded` debug line per source with its load timing — fired on
   * first `ensure(id)`, not at boot. A disk-backed glob's index build now runs
   * in an isolated child process (ADR-0042); its progress logs come from that
   * child's inherited stderr, not from this logger.
   */
  logger?: SparqlyLogger;
  /**
   * Project config directory — the root for `<configDir>/.sparqly/index/<id>/`
   * Glob index directories (ADR-0041). Defaults to `process.cwd()`.
   */
  configDir?: string;
  /**
   * The sparqly version recorded in a freshly built disk-backed Glob index
   * manifest (ADR-0041). Forwarded to `resolveSourceResult`, which falls back
   * to a placeholder token when omitted.
   */
  sparqlyVersion?: string;
  /**
   * Overrides the Glob index cache root (ADR-0041, #345). When set, disk-backed
   * globs build and reuse their index under `<indexCacheDir>/<id>/` instead of
   * the default `<configDir>/.sparqly/index/<id>/`. Threaded from the project
   * config's `index.dir` field.
   */
  indexCacheDir?: string;
  /**
   * Spawns the isolated `sparqly index @id` child process that builds a
   * disk-backed glob's Glob index (ADR-0042). Injected from the CLI `serve`
   * entry point — `libs/server` cannot reach the CLI that knows how to
   * re-invoke itself. Omitting it leaves disk-backed builds unavailable: a
   * first touch of a not-yet-built disk-backed source then throws.
   */
  spawnIndexBuild?: SpawnIndexBuild;
  /**
   * Maximum number of child-process index builds running at once
   * (`index.concurrency`, ADR-0042). Disk-backed sources first-touched past
   * the cap queue for a free slot. Defaults to 2.
   */
  indexConcurrency?: number;
  /**
   * Window after a failing build during which a repeat request for the same
   * source is suppressed — caps the spawn rate so a permanently failing
   * source (e.g. a malformed RDF file) does not turn every HTTP touch into a
   * fresh `sparqly index` child. Forwarded to {@link IndexBuildPool}.
   */
  indexBuildCooldownMs?: number;
  /** Clock injection for tests; forwarded to {@link IndexBuildPool}. */
  now?: () => number;
  /**
   * Observer for **Source load state** transitions — `load-start` /
   * `load-success` / `load-failure` for in-memory ensures, `build-start`
   * for disk-backed first-touch builds, `unload` / `build-cancel` for the
   * operator-initiated edges that arrive in later slices of parent #352.
   * Default: a fresh no-op emitter (no subscribers). The SSE wiring
   * (`SourcesController`) injects the shared emitter so transitions reach
   * the ring buffer and the live stream (ADR-0044, #354).
   */
  sourceStateEmitter?: SourceStateEmitter;
}

export class EngineMap {
  // TypeScript parameter properties collapse the field declarations and the
  // constructor body — `buildPool` caps the child-process index builds
  // (ADR-0042); `stateEmitter` is the optional **Source load state**
  // transition observer (ADR-0044, #354), undefined when no SSE wiring is
  // attached so `serve` outside the sources controller still works as before.
  private constructor(
    private readonly entries: Map<string, Entry>,
    private readonly resolutionRegistry: ReadonlyArray<ParsedSource>,
    private readonly logger: SparqlyLogger | undefined,
    private readonly configDir: string,
    private readonly sparqlyVersion: string | undefined,
    private readonly indexCacheDir: string | undefined,
    private readonly buildPool: IndexBuildPool,
    private readonly stateEmitter: SourceStateEmitter | undefined,
  ) {}

  static async create(
    servedRegistry: ReadonlyArray<ParsedSource>,
    options: EngineMapOptions = {},
  ): Promise<EngineMap> {
    const resolutionRegistry = options.resolutionRegistry ?? servedRegistry;
    const entries = new Map<string, Entry>();
    for (const src of servedRegistry) {
      if (src.kind === 'reference') continue;
      if (src.id === undefined) continue;
      if (src.kind === 'endpoint') {
        const loaded: LoadedEntry = {
          engine: new QueryEngine(src, {
            id: src.id ?? src.endpoint,
            mode: 'pass-through',
            logger: options.logger,
          }),
          storeRef: undefined,
          sources: { mode: 'pass-through', endpoint: src },
        };
        entries.set(src.id, {
          source: src,
          files: [],
          loadedAt: undefined,
          loadMs: undefined,
          loaded: Promise.resolve(ok(loaded)),
          disk: undefined,
          closeIndex: undefined,
          current: loaded,
          staleReasonSeen: undefined,
          lastError: undefined,
        });
        continue;
      }
      entries.set(src.id, {
        source: src,
        files: [],
        loadedAt: undefined,
        loadMs: undefined,
        loaded: undefined,
        disk: undefined,
        closeIndex: undefined,
        current: undefined,
        staleReasonSeen: undefined,
        lastError: undefined,
      });
    }
    const configDir = options.configDir ?? process.cwd();
    const indexCacheDir = options.indexCacheDir;
    // Resolve an entry's on-disk index path once for the pool callbacks —
    // the pool only sees `@id`s and can't reach the source/configDir.
    const indexDirOf = (sourceId: string): string | undefined => {
      const entry = entries.get(sourceId);
      if (entry === undefined || !isDiskBacked(entry.source)) return undefined;
      const { indexId } = diskBackedIndexIdentity(entry.source);
      return globIndexDir(configDir, indexId, indexCacheDir);
    };
    const stateEmitter = options.sourceStateEmitter;
    const buildPool = new IndexBuildPool({
      concurrency: options.indexConcurrency ?? 2,
      spawn: options.spawnIndexBuild ?? spawnIndexBuildUnavailable,
      cooldownMs: options.indexBuildCooldownMs,
      now: options.now,
      // ADR-0043: a cancelled rebuild leaves the prior Glob index intact at
      // the real path, but its `<indexDir>.building-<pid>-*` temp dir would
      // linger without an active sweep — `prepare()` only runs at the start
      // of the *next* build, and a cancel may never be followed by one.
      sweepTempDir: async (sourceId) => {
        const dir = indexDirOf(sourceId);
        if (dir === undefined) return;
        await sweepGlobIndexTempDirs(dir);
      },
      // The pool itself stays SSE-unaware (ADR-0044): it just reports the
      // settlement outcome and EngineMap maps that to a transition the
      // SourceStateBroker projects into a wire row.
      onSettle: (sourceId, outcome, info) => {
        const entry = entries.get(sourceId);
        if (outcome === 'success') {
          // Drop any prior memoized open so the next touch re-opens the freshly
          // built index. Without this, a rebuild that ran while an old `ready`
          // was settled would keep serving the old quads until restart. Also
          // clear any prior sticky failure (#360) — a successful build returns
          // the entry to the normal `ready` rest state.
          if (entry) {
            entry.disk = undefined;
            entry.lastError = undefined;
          }
          stateEmitter?.emit({ kind: 'build-success', sourceId });
        } else if (outcome === 'failure') {
          // Sticky-failed (#360): land the pool's failure info on the entry
          // so `readState` projects `failed` with the inline error block and
          // `ensureDiskBacked` skips re-spawning until Retry. `info` is the
          // pool's guarantee on every `'failure'` outcome.
          if (entry && info !== undefined) entry.lastError = info;
          stateEmitter?.emit({ kind: 'build-failure', sourceId });
        } else {
          stateEmitter?.emit({ kind: 'build-cancel', sourceId });
        }
      },
    });
    return new EngineMap(
      entries,
      resolutionRegistry,
      options.logger,
      configDir,
      options.sparqlyVersion,
      indexCacheDir,
      buildPool,
      stateEmitter,
    );
  }

  allIds(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Returns the engine for `id`, triggering a one-shot lazy load on first call
   * for materialized entries (ADR-0031). Concurrent first-touch calls share
   * the in-flight load promise — `resolveSourceResult` runs exactly once per
   * source per attempt. On `err`, the memoized load is cleared so a follow-up
   * call retries fresh, allowing the user to fix the underlying file/ref
   * without restarting the server (#290).
   *
   * A disk-backed glob (ADR-0041) runs a state machine instead: a not-yet-built
   * index reports `err(IndexingError)` while a background build runs; an
   * already-built index opens straight to `ready`.
   */
  ensure(id: string): ResultAsync<QueryEngine, SourceError | IndexingError> {
    return this.ensureEntry(id).map((loaded) => loaded.engine);
  }

  /**
   * Triggers the same one-shot lazy load as {@link ensure} but returns the
   * resolved {@link LoadedSources} discriminant — the diff service uses this
   * to read the loader-attached source-record sidecar (ADR-0032) without
   * touching the engine.
   */
  ensureSources(
    id: string,
  ): ResultAsync<LoadedSources, SourceError | IndexingError> {
    return this.ensureEntry(id).map((loaded) => loaded.sources);
  }

  private ensureEntry(
    id: string,
  ): ResultAsync<LoadedEntry, SourceError | IndexingError> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`EngineMap: no source with @id "${id}"`);
    if (isDiskBacked(entry.source)) {
      return this.ensureDiskBacked(entry);
    }
    if (entry.loaded === undefined) {
      entry.loaded = this.loadEntry(entry);
    }
    return new ResultAsync(entry.loaded);
  }

  /**
   * Disk-backed glob state machine (ADR-0041/-0042). A touch either opens an
   * already-built index (`ready`, then memoized) or requests a capped
   * child-process build and reports `indexing`. The `indexing` outcome is not
   * memoized — each touch re-checks the on-disk manifest — yet concurrent
   * touches still share the one in-flight resolution, so the build is
   * requested once per attempt.
   */
  private ensureDiskBacked(
    entry: Entry,
  ): ResultAsync<LoadedEntry, SourceError | IndexingError> {
    if (entry.disk === undefined) {
      entry.disk = this.resolveDiskBacked(entry);
    }
    return new ResultAsync(entry.disk);
  }

  private async resolveDiskBacked(
    entry: Entry,
  ): Promise<Result<LoadedEntry, SourceError | IndexingError>> {
    const sourceId = entry.source.id as string;
    // Sticky-failed (#360): a prior build for this entry failed and no Retry
    // has cleared it — repeated query touches must not silently re-spawn the
    // child (turning every HTTP touch into a fresh malformed-file build). We
    // return the same `indexing` retry-error so the existing 503 boundary
    // still applies; the Sources page surfaces `failed` via `readState`,
    // which reads `entry.lastError` directly.
    if (entry.lastError !== undefined) {
      entry.disk = undefined;
      return err(indexingError(sourceId));
    }
    const indexDir = globIndexDir(this.configDir, sourceId, this.indexCacheDir);
    if (await manifestExists(indexDir)) {
      // A built index is present — open it straight to `ready` (a fast
      // LevelDB open, not a multi-GB build), so no request sees `503`. A
      // corrupt index errs; clear the slot so a later touch retries.
      const loaded = await this.loadEntry(entry);
      if (loaded.isErr()) entry.disk = undefined;
      return loaded;
    }
    // No index yet — request a capped child-process build (ADR-0042) and
    // report `indexing` so `serve` answers `503` without blocking its HTTP
    // loop. The slot is cleared so the next touch re-checks the manifest (the
    // child may have finished); `pool.request` is idempotent, so the repeated
    // touches that precede a clear coalesce onto the one build child.
    entry.disk = undefined;
    // Emit `build-start` only when a child is actually requested. The
    // pool's idempotence (a coalesced request inside the cooldown window
    // or against an already-running child) is intentionally observable
    // here as a duplicate emit — the Sources page treats each event as
    // an idempotent row replace, so a redundant `indexing` re-paint is
    // harmless and cheaper than threading a "was-spawned" boolean back
    // through the pool. Future slices of #352 wire `build-success` /
    // `build-failure` / `build-cancel` from a pool completion callback.
    this.stateEmitter?.emit({ kind: 'build-start', sourceId });
    this.buildPool.request(sourceId);
    return err(indexingError(sourceId));
  }

  /**
   * Resolves once no child-process index build is running or queued
   * (ADR-0042). Used by tests to await a disk-backed glob's build before
   * reading its `ready` state.
   */
  async whenIdle(): Promise<void> {
    await this.buildPool.whenIdle();
  }

  /**
   * User-triggered **(Re)build index** path (ADR-0043, #358, #360). Coalesces
   * onto the existing in-flight build for the same source if one is already
   * running; otherwise clears any sticky-failed marker (#360) along with the
   * pool's post-failure cooldown for the same id and requests a fresh
   * child-process build through the same {@link IndexBuildPool} the
   * auto-trigger uses. Returns the outcome so the controller can map to the
   * right HTTP status (`202` for `'requested'` / `'in-flight'`).
   * Throws when `id` is not a disk-backed entry — initial-build / rebuild
   * symmetry only applies to disk-backed globs (an in-memory source uses
   * Reload instead).
   */
  requestBuild(id: string): 'requested' | 'in-flight' {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`EngineMap: no source with @id "${id}"`);
    if (!isDiskBacked(entry.source)) {
      throw new Error(
        `EngineMap.requestBuild: '${id}' is not a disk-backed source — ` +
          `(Re)build index is disk-backed only (ADR-0043)`,
      );
    }
    if (this.buildPool.isBuilding(id)) return 'in-flight';
    // Drop any settled-`ready` open so the next touch re-checks the manifest
    // and observes the freshly-built index — without this clear, a rebuild
    // against a `ready` entry would keep serving the old quads from the
    // memoized open until process restart. Also clear the sticky-failed
    // marker (#360): Retry is the only path that transitions a sticky-failed
    // disk-backed entry back out of `failed`, so the next touch can spawn.
    // The pool's per-source post-failure cooldown gets cleared in lockstep —
    // Retry is an operator-explicit recovery and must not be suppressed by
    // the automatic backoff that gates the spawn-storm path.
    entry.disk = undefined;
    entry.lastError = undefined;
    this.buildPool.forgetFailure(id);
    this.stateEmitter?.emit({ kind: 'build-start', sourceId: id });
    this.buildPool.request(id);
    return 'requested';
  }

  /**
   * User-triggered cancel of a disk-backed (Re)build (ADR-0043, #358).
   * SIGTERMs the running child via the pool; the temp-dir sweep and the
   * `build-cancel` transition both flow from the pool's cancel-aware exit
   * handler. Cancel against an unknown id, a non-disk-backed entry, or a
   * source with no in-flight build is a silent no-op — the route still
   * returns `202` because the user's intent ("there should be no rebuild
   * running") is satisfied either way.
   */
  cancelBuild(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (!isDiskBacked(entry.source)) return;
    this.buildPool.cancel(id);
  }

  private async loadEntry(
    entry: Entry,
  ): Promise<Result<LoadedEntry, SourceError>> {
    const src = entry.source;
    const sourceId = src.id ?? '(source)';
    // `load-start` fires before any I/O so the Sources page sees `loading`
    // for the entire duration of the in-flight load, including the
    // resolveSourceResult turn (which is the slow part for large globs).
    // Clear any prior failure now — the row transitions out of `failed` for
    // the lifetime of this attempt (the projector reads `loading` instead).
    // A re-failure overwrites the slot below; a success leaves it cleared.
    entry.lastError = undefined;
    this.stateEmitter?.emit({ kind: 'load-start', sourceId });
    const start = Date.now();
    const resolved = await resolveSourceResult(src, {
      registry: this.resolutionRegistry,
      logger: this.logger,
      configDir: this.configDir,
      sparqlyVersion: this.sparqlyVersion,
      indexCacheDir: this.indexCacheDir,
    });
    if (resolved.isErr()) {
      // Clear memoization so the next request retries — gives the user a
      // self-healing path when they fix the underlying file/ref/config.
      entry.loaded = undefined;
      // Capture the failure inline (#360). The internal `SourceError.kind`
      // ('glob-load', 'view-validation', 'endpoint-fetch', …) rides verbatim
      // onto the Sources page row's error chip; the formatted message is the
      // one-liner the chip shows. The slot persists across the cleared
      // `entry.loaded` so `readState` can project `failed` between query
      // touches — a successful follow-up load clears it via the load-start
      // path above, preserving ADR-0031's self-heal.
      entry.lastError = {
        kind: resolved.error.kind,
        message: formatSourceError(resolved.error),
      };
      this.stateEmitter?.emit({ kind: 'load-failure', sourceId });
      return err(resolved.error);
    }
    const sources = resolved.value;
    let loaded: LoadedEntry;
    if (sources.mode === 'pass-through') {
      loaded = {
        engine: new QueryEngine(sources.endpoint, {
          id: sourceId,
          mode: 'pass-through',
          logger: this.logger,
        }),
        storeRef: undefined,
        sources: { mode: 'pass-through', endpoint: sources.endpoint },
      };
      entry.files = [];
    } else if (sources.mode === 'disk-backed') {
      // A disk-backed glob queries through the same engine an in-memory glob
      // uses — Comunica's `sources: [...]` context over the on-disk quad store
      // (ADR-0041). The LevelDB lock is held for the life of the process and
      // released by `close()`.
      loaded = {
        engine: new QueryEngine(
          sources.source,
          { id: sourceId, mode: 'materialized', logger: this.logger },
          { unionDefaultGraph: unionDefaultGraphEnabled(src) },
        ),
        storeRef: undefined,
        sources: {
          mode: 'disk-backed',
          source: sources.source,
          indexDir: sources.indexDir,
        },
      };
      entry.files = [...sources.files];
      entry.closeIndex = sources.close;
    } else {
      const storeRef: StoreRef = { current: sources.store };
      const ref = storeRef;
      loaded = {
        engine: new QueryEngine(
          () => ref.current,
          {
            id: sourceId,
            mode: src.kind === 'view' ? 'view' : 'materialized',
            logger: this.logger,
          },
          { unionDefaultGraph: unionDefaultGraphEnabled(src) },
        ),
        storeRef,
        sources: {
          mode: 'materialized',
          store: sources.store,
          sourceRecords: sources.sourceRecords,
        },
      };
      entry.files = [...sources.files];
    }
    entry.current = loaded;
    const ms = Date.now() - start;
    entry.loadMs = ms;
    entry.loadedAt = Date.now();
    this.stateEmitter?.emit({ kind: 'load-success', sourceId });
    if (loaded.storeRef) {
      this.logger?.debug('source-loaded', {
        source: sourceId,
        kind: src.kind,
        files: entry.files.length,
        quads: loaded.storeRef.current.size,
        ms,
      });
    } else {
      this.logger?.debug('source-loaded', {
        source: sourceId,
        kind: src.kind,
        ms,
      });
    }
    return ok(loaded);
  }

  /**
   * Re-resolves an in-memory entry and **atomically swaps** `StoreRef.current`
   * over to the freshly built store (parent #352, #356). The same `StoreRef`
   * object the entry exposed before the call is preserved — `getStoreRef(id)`
   * returns the same instance — so existing holders pick up the new store
   * transparently. Queries already iterating the prior `Store` continue
   * against the snapshot they captured: N3 stores are never mutated in place.
   * Body lives in {@link reloadEntry} (see `engine-map-actions.ts`) to keep
   * this file under its `max-lines` cap; the class binds `loadEntry` so the
   * helper runs the same materialization path a first-touch `ensure` would.
   * Endpoint and disk-backed sources have no in-memory reload semantics and
   * short-circuit silently (disk-backed uses **(Re)build index** per ADR-0043).
   */
  async reload(id: string): Promise<Result<QueryEngine, SourceError>> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`EngineMap: no source with @id "${id}"`);
    return reloadEntry(entry, (e) => this.loadEntry(e));
  }

  /**
   * Drops the live materialization of an in-memory entry (parent #352,
   * #356). Body in {@link unloadEntry} — see `engine-map-actions.ts` for
   * the idempotence and short-circuit semantics.
   */
  async unload(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`EngineMap: no source with @id "${id}"`);
    await unloadEntry(id, entry, this.stateEmitter);
  }

  /**
   * Snapshot of an entry's current **Source load state** for the Sources page
   * (`GET /api/sources`, #353). Pure observer — never triggers lazy
   * materialization (ADR-0031) and never spawns a child-process build
   * (ADR-0042). The projection logic lives in {@link projectEntryState} to
   * keep this file under the `max-lines` lint cap.
   */
  async readState(id: string): Promise<SourceRuntime> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`EngineMap: no source with @id "${id}"`);
    const runtime = await projectEntryState(
      entry,
      this.configDir,
      this.indexCacheDir,
      this.sparqlyVersion,
      (sid) => this.buildPool.isBuilding(sid),
    );
    reconcileStaleDedup(entry, id, runtime, this.stateEmitter);
    return runtime;
  }

  /**
   * Returns the {@link ParsedSource} the engine for `id` was built from, or
   * `undefined` when there is no engine for that id. Used by the route layer
   * to detect when an incoming `@id:ref` request asks for a pin different from
   * the one the pre-built engine carries — in that case the request resolves a
   * fresh, on-demand pinned engine instead of reusing the registered one
   * (ADR-0029, issue #278).
   */
  getSource(id: string): ParsedSource | undefined {
    return this.entries.get(id)?.source;
  }

  /**
   * Returns the pass-through {@link QueryEngine} pre-built at boot for an
   * **Endpoint source** entry, or `undefined` when `id` is unknown or
   * resolves to a non-endpoint source (#359, parent #352). The endpoint
   * branch of {@link create} stamps the engine onto `entry.current` at boot
   * — no lazy materialization is involved — so the **Test connection**
   * probe reaches a stable engine instance without racing the materialized
   * load path.
   */
  getEndpointEngine(id: string): QueryEngine | undefined {
    const entry = this.entries.get(id);
    if (!entry || entry.source.kind !== 'endpoint') return undefined;
    return entry.current?.engine;
  }

  getStoreRef(id: string): StoreRef | undefined {
    return this.entries.get(id)?.current?.storeRef;
  }

  getFiles(id: string): ReadonlyArray<string> {
    return this.entries.get(id)?.files ?? [];
  }

  setFiles(id: string, paths: ReadonlyArray<string>): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.files = [...paths];
  }

  allFiles(): string[] {
    const out: string[] = [];
    for (const entry of this.entries.values()) {
      for (const f of entry.files) out.push(f);
    }
    return out;
  }

  async close(): Promise<void> {
    // SIGTERM any running child-process index builds — `serve` shutdown
    // (Ctrl-C) is instant, never blocked on a multi-GB build (ADR-0042).
    await this.buildPool.shutdown();
    for (const entry of this.entries.values()) {
      if (entry.closeIndex) {
        try {
          await entry.closeIndex();
        } catch {
          // Best-effort lock release on shutdown.
        }
        entry.closeIndex = undefined;
      }
    }
    this.entries.clear();
  }
}

