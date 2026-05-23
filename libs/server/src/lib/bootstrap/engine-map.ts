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
  /** Superset of the served set used to walk `from:` chains. Defaults to served. */
  resolutionRegistry?: ReadonlyArray<ParsedSource>;
  logger?: SparqlyLogger;
  /** Defaults to `process.cwd()`. */
  configDir?: string;
  /** Recorded in freshly built Glob index manifests. */
  sparqlyVersion?: string;
  /** Overrides the Glob index cache root (default `<configDir>/.sparqly/index/<id>/`). */
  indexCacheDir?: string;
  /**
   * Spawns the isolated `sparqly index @id` child process. Injected by the CLI
   * since `libs/server` can't reach the CLI entry. Omitting it makes first
   * touch of a not-yet-built disk-backed source throw.
   */
  spawnIndexBuild?: SpawnIndexBuild;
  /** Max concurrent child-process index builds. Defaults to 2. */
  indexConcurrency?: number;
  /** Window suppressing repeat build requests after a failure. */
  indexBuildCooldownMs?: number;
  /** Clock injection for tests. */
  now?: () => number;
  sourceStateEmitter?: SourceStateEmitter;
}

export class EngineMap {
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
    // The pool only sees `@id`s; this resolves the on-disk path for it.
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
      // A cancel leaves the prior index intact, but its `.building-<pid>-*`
      // temp dir would linger — `prepare()` only runs at the start of the
      // next build, and a cancel may never be followed by one.
      sweepTempDir: async (sourceId) => {
        const dir = indexDirOf(sourceId);
        if (dir === undefined) return;
        await sweepGlobIndexTempDirs(dir);
      },
      onSettle: (sourceId, outcome, info) => {
        const entry = entries.get(sourceId);
        if (outcome === 'success') {
          // Drop the memoized open so the next touch re-opens the freshly
          // built index instead of serving old quads.
          if (entry) {
            entry.disk = undefined;
            entry.lastError = undefined;
          }
          stateEmitter?.emit({ kind: 'build-success', sourceId });
        } else if (outcome === 'failure') {
          // Sticky: makes `ensureDiskBacked` skip re-spawning until Retry.
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
   * Returns the engine for `id`, triggering a one-shot lazy load on first call.
   * Concurrent first-touches share the in-flight promise. On `err`, the memo
   * slot is cleared so a follow-up retries fresh (self-heal). Disk-backed
   * globs run a separate state machine — see {@link ensureDiskBacked}.
   */
  ensure(id: string): ResultAsync<QueryEngine, SourceError | IndexingError> {
    return this.ensureEntry(id).map((loaded) => loaded.engine);
  }

  /** Like {@link ensure} but returns the `LoadedSources` discriminant (for diff). */
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
   * Disk-backed glob state machine. A touch either opens an already-built
   * index (`ready`, then memoized) or requests a capped child build and
   * reports `indexing`. The `indexing` outcome is not memoized — each touch
   * re-checks the manifest — yet concurrent touches share the in-flight
   * resolution, so the build is requested once per attempt.
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
    // Sticky-failed: skip re-spawning until Retry clears it. We still return
    // `indexing` so the 503 boundary applies; the Sources page surfaces
    // `failed` via `readState` reading `entry.lastError` directly.
    if (entry.lastError !== undefined) {
      entry.disk = undefined;
      return err(indexingError(sourceId));
    }
    const indexDir = globIndexDir(this.configDir, sourceId, this.indexCacheDir);
    if (await manifestExists(indexDir)) {
      const loaded = await this.loadEntry(entry);
      if (loaded.isErr()) entry.disk = undefined;
      return loaded;
    }
    // No index yet — request a capped child build and report `indexing`.
    // The slot is cleared so the next touch re-checks the manifest;
    // `pool.request` is idempotent so coalesced touches share one child.
    entry.disk = undefined;
    this.stateEmitter?.emit({ kind: 'build-start', sourceId });
    this.buildPool.request(sourceId);
    return err(indexingError(sourceId));
  }

  /** Resolves once no child build is running or queued. */
  async whenIdle(): Promise<void> {
    await this.buildPool.whenIdle();
  }

  /**
   * User-triggered rebuild. Coalesces onto an in-flight build for the same
   * source; otherwise clears any sticky-failed marker and the pool's
   * post-failure cooldown and spawns a fresh child. Throws when `id` is
   * not disk-backed (in-memory sources use Reload).
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
    // Drop the memoized `ready` open so the next touch picks up the new index.
    // Retry is the only path out of sticky-failed and must bypass the
    // automatic backoff that gates the spawn-storm path.
    entry.disk = undefined;
    entry.lastError = undefined;
    this.buildPool.forgetFailure(id);
    this.stateEmitter?.emit({ kind: 'build-start', sourceId: id });
    this.buildPool.request(id);
    return 'requested';
  }

  /**
   * SIGTERMs the running build child. Cancel against an unknown id, a
   * non-disk-backed entry, or an idle source is a silent no-op.
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
    // Clear prior failure so the row reads `loading`, not stale `failed`,
    // for the lifetime of this attempt. Re-failure overwrites below.
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
      // Clear memoization so the next request retries (self-heal).
      // `lastError` persists across the cleared `entry.loaded` so the row
      // reads `failed` between query touches.
      entry.loaded = undefined;
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
      // Uses the same engine as in-memory globs; LevelDB lock held until close().
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
   * Re-resolves an in-memory entry and atomically swaps `StoreRef.current`
   * to the freshly built store — same `StoreRef` instance, so existing
   * holders pick up the new store transparently. Endpoint and disk-backed
   * entries short-circuit (disk-backed uses {@link requestBuild}).
   */
  async reload(id: string): Promise<Result<QueryEngine, SourceError>> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`EngineMap: no source with @id "${id}"`);
    return reloadEntry(entry, (e) => this.loadEntry(e));
  }

  /** Drops the live materialization of an in-memory entry. */
  async unload(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`EngineMap: no source with @id "${id}"`);
    await unloadEntry(id, entry, this.stateEmitter);
  }

  /** Pure observer — never triggers lazy load and never spawns a child build. */
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

  getSource(id: string): ParsedSource | undefined {
    return this.entries.get(id)?.source;
  }

  /** Pass-through engine pre-built at boot for endpoint entries; otherwise undefined. */
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
    // SIGTERM running build children so shutdown isn't blocked on a multi-GB build.
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

