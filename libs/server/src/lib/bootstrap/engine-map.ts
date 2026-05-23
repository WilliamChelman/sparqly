import { err, ok, ResultAsync, type Result } from 'neverthrow';
import type { SparqlyLogger } from 'common';
import {
  globIndexDir,
  QueryEngine,
  resolveSourceResult,
  unionDefaultGraphEnabled,
  type ParsedSource,
  type SourceError,
} from 'core';
import type { StoreRef } from './tokens';
import { isDiskBacked, manifestExists } from './disk-backed-index';
import { projectEntryState } from './engine-map-read-state';
import {
  indexingError,
  spawnIndexBuildUnavailable,
  type IndexingError,
  type LoadedSources,
} from './engine-map-types';
import { IndexBuildPool, type SpawnIndexBuild } from './index-build-pool';
import type { SourceRuntime } from '../sources/source-row-projector';
import type { SourceStateEmitter } from '../sources/source-state-emitter';

export type { IndexingError, LoadedSources } from './engine-map-types';
export { isIndexingError } from './engine-map-types';

interface LoadedEntry {
  engine: QueryEngine;
  storeRef: StoreRef | undefined;
  sources: LoadedSources;
}

interface Entry {
  source: ParsedSource;
  /**
   * Absolute paths attributed to this source for the snippet allow-list.
   * Pre-seeded at boot via `walkGlobPaths` (ADR-0031) for un-touched
   * materialized sources, then overwritten by {@link EngineMap.setFiles} on
   * watcher rebuilds and inside `loadEntry` once the source actually
   * resolves. Empty for endpoint/pass-through entries.
   */
  files: string[];
  /**
   * Layer 2 materialization metric (#355): epoch-ms stamp captured the
   * instant the last successful `loadEntry` settled. `undefined` until the
   * first ok-resolution; later slices clear it again on `unload`. The page
   * renders this verbatim — no formatting, no timezone assumption.
   */
  loadedAt: number | undefined;
  /**
   * Layer 2 materialization metric (#355): wall-clock ms the last successful
   * load took (start measured before any I/O, end measured after the engine
   * is wired up). The Sources page surfaces this to spot slow loaders.
   */
  loadMs: number | undefined;
  /**
   * Lazy-materialization slot (ADR-0031). `undefined` until first
   * {@link EngineMap.ensure} call; thereafter a memoized in-flight (or
   * settled-`ok`) promise. Endpoint entries are populated synchronously at
   * construction. On `err(SourceError)` the slot is cleared so the next
   * `ensure(id)` retries fresh — fixes #290's restart-required failures.
   * Unused by disk-backed globs (they run the `disk` state machine).
   */
  loaded: Promise<Result<LoadedEntry, SourceError>> | undefined;
  /**
   * Disk-backed glob state machine (ADR-0041/-0042). `undefined` until first
   * touch and again whenever a touch finds the index still building, so the
   * next `ensure(id)` re-checks the manifest. Memoized only on `ready`.
   * Concurrent touches share the one in-flight promise per attempt.
   */
  disk: Promise<Result<LoadedEntry, SourceError | IndexingError>> | undefined;
  /** Releases the LevelDB lock on a disk-backed Glob index; awaited by `close()`. */
  closeIndex: (() => Promise<void>) | undefined;
  /**
   * Synchronous view of the settled-`ok` `loaded` shape — watcher and snippet
   * wiring peek at the store ref without `await`. `undefined` while loading
   * or after a failed load.
   */
  current: LoadedEntry | undefined;
}

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
  private readonly entries: Map<string, Entry>;
  private readonly resolutionRegistry: ReadonlyArray<ParsedSource>;
  private readonly logger: SparqlyLogger | undefined;
  private readonly configDir: string;
  private readonly sparqlyVersion: string | undefined;
  private readonly indexCacheDir: string | undefined;
  /** Caps and queues the isolated child-process index builds (ADR-0042). */
  private readonly buildPool: IndexBuildPool;
  /**
   * Optional **Source load state** transition observer (ADR-0044, #354).
   * `undefined` means no SSE wiring is attached — `serve` outside the
   * sources controller still works exactly as before.
   */
  private readonly stateEmitter: SourceStateEmitter | undefined;

  private constructor(
    entries: Map<string, Entry>,
    resolutionRegistry: ReadonlyArray<ParsedSource>,
    logger: SparqlyLogger | undefined,
    configDir: string,
    sparqlyVersion: string | undefined,
    indexCacheDir: string | undefined,
    buildPool: IndexBuildPool,
    stateEmitter: SourceStateEmitter | undefined,
  ) {
    this.entries = entries;
    this.resolutionRegistry = resolutionRegistry;
    this.logger = logger;
    this.configDir = configDir;
    this.sparqlyVersion = sparqlyVersion;
    this.indexCacheDir = indexCacheDir;
    this.buildPool = buildPool;
    this.stateEmitter = stateEmitter;
  }

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
      });
    }
    const buildPool = new IndexBuildPool({
      concurrency: options.indexConcurrency ?? 2,
      spawn: options.spawnIndexBuild ?? spawnIndexBuildUnavailable,
      cooldownMs: options.indexBuildCooldownMs,
      now: options.now,
    });
    return new EngineMap(
      entries,
      resolutionRegistry,
      options.logger,
      options.configDir ?? process.cwd(),
      options.sparqlyVersion,
      options.indexCacheDir,
      buildPool,
      options.sourceStateEmitter,
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

  private async loadEntry(
    entry: Entry,
  ): Promise<Result<LoadedEntry, SourceError>> {
    const src = entry.source;
    const sourceId = src.id ?? '(source)';
    // `load-start` fires before any I/O so the Sources page sees `loading`
    // for the entire duration of the in-flight load, including the
    // resolveSourceResult turn (which is the slow part for large globs).
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
   * Snapshot of an entry's current **Source load state** for the Sources page
   * (`GET /api/sources`, #353). Pure observer — never triggers lazy
   * materialization (ADR-0031) and never spawns a child-process build
   * (ADR-0042). The projection logic lives in {@link projectEntryState} to
   * keep this file under the `max-lines` lint cap.
   */
  async readState(id: string): Promise<SourceRuntime> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`EngineMap: no source with @id "${id}"`);
    return projectEntryState(entry, this.configDir, this.indexCacheDir);
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

