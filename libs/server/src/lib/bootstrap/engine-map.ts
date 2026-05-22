import { stat } from 'node:fs/promises';
import { err, ok, ResultAsync, type Result } from 'neverthrow';
import type { SparqlyLogger } from 'common';
import {
  formatSourceError,
  globIndexDir,
  indexManifestPath,
  QueryEngine,
  resolveSourceResult,
  unionDefaultGraphEnabled,
  type ParsedEndpointSource,
  type ParsedGlobSource,
  type ParsedSource,
  type SourceError,
  type SourceRecordSidecar,
} from 'core';
import type * as RDF from '@rdfjs/types';
import type { Store } from 'n3';
import type { StoreRef } from './tokens';

/**
 * Loaded view of a served source, surfaced to consumers that need the
 * underlying Store and (where available) the loader-attached source-record
 * sidecar (ADR-0032). Discriminated mirrors `QuerySources` so callers can
 * dispatch on `mode` without reaching into `engine-map` internals.
 */
export type LoadedSources =
  | { mode: 'materialized'; store: Store; sourceRecords?: SourceRecordSidecar }
  | { mode: 'pass-through'; endpoint: ParsedEndpointSource }
  | {
      /**
       * A `storage: disk` glob hosted by `serve` from its on-disk Glob index
       * (ADR-0041). The quads live in an embedded quad store, not the V8 heap,
       * and carry no Source record sidecar — `diff` rejects this mode.
       */
      mode: 'disk-backed';
      source: RDF.Source;
      indexDir: string;
    };

/**
 * Returned by {@link EngineMap.ensure}/{@link EngineMap.ensureSources} when a
 * disk-backed glob's Glob index is still building in the background (ADR-0041,
 * #340). It is not a load *failure* — it is a transient "retry shortly" state
 * — but it travels the same `Result` error channel so the `serve` HTTP
 * boundary can route it to a `503` the way every other source outcome routes
 * through an error-to-status mapper.
 */
export interface IndexingError {
  kind: 'indexing';
  /** Source `@id` whose Glob index is still building. */
  source: string;
  message: string;
}

/**
 * Type guard separating an {@link IndexingError} from any other tagged error
 * travelling the `Result` channel (a core `SourceError`, a `TargetError`). The
 * parameter is the structural `{ kind }` shape every such error carries so the
 * `serve` boundary can call this on its widest error union.
 */
export function isIndexingError(
  error: { kind: string },
): error is IndexingError {
  return error.kind === 'indexing';
}

function indexingError(source: string): IndexingError {
  return {
    kind: 'indexing',
    source,
    message: `disk-backed glob '${source}' is building its index — retry shortly`,
  };
}

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
   * `serve`'s lazy-materialization contract (ADR-0031): for materialized
   * entries this is `undefined` until the first {@link EngineMap.ensure} call
   * triggers the load, then a memoized in-flight (and eventually settled)
   * promise of the {@link Result}-typed {@link LoadedEntry}. Endpoint
   * pass-through entries are populated synchronously at construction time —
   * no load to defer — and their `loaded` promise resolves immediately with
   * `ok(loaded)`. When a load resolves with `err(SourceError)`, the slot is
   * cleared so the next `ensure(id)` call retries fresh, letting the user fix
   * the underlying file/ref/config without restarting the server (#290).
   *
   * Unused by disk-backed globs — those run the {@link disk} state machine.
   */
  loaded: Promise<Result<LoadedEntry, SourceError>> | undefined;
  /**
   * Disk-backed glob state machine (ADR-0041, #340). `undefined` until first
   * touch, then a memoized promise of the disk slot: `err(IndexingError)`
   * while the background index build runs, `ok(LoadedEntry)` once the index is
   * `ready`. A failed build clears the slot so the next `ensure(id)` retries
   * the build. Concurrent first-touches share the one in-flight promise.
   */
  disk: Promise<Result<LoadedEntry, SourceError | IndexingError>> | undefined;
  /**
   * Releases the embedded LevelDB lock on a disk-backed glob's Glob index.
   * Set once the index opens; awaited by {@link EngineMap.close}.
   */
  closeIndex: (() => Promise<void>) | undefined;
  /**
   * Synchronously-available view of the loaded shape, mirroring `loaded` once
   * it has settled with `ok`. Used by watcher / snippet wiring that needs to
   * peek at the store ref without `await`ing. Remains `undefined` while a
   * load is in-flight or after a failed load.
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
   * first `ensure(id)`, not at boot — and the `index-build-start` /
   * `index-build-complete` / `index-build-failed` lines for disk-backed globs.
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
}

export class EngineMap {
  private readonly entries: Map<string, Entry>;
  private readonly resolutionRegistry: ReadonlyArray<ParsedSource>;
  private readonly logger: SparqlyLogger | undefined;
  private readonly configDir: string;
  private readonly sparqlyVersion: string | undefined;
  /** In-flight background index builds — awaited by {@link whenIdle}. */
  private readonly inFlightBuilds = new Set<Promise<unknown>>();

  private constructor(
    entries: Map<string, Entry>,
    resolutionRegistry: ReadonlyArray<ParsedSource>,
    logger: SparqlyLogger | undefined,
    configDir: string,
    sparqlyVersion: string | undefined,
  ) {
    this.entries = entries;
    this.resolutionRegistry = resolutionRegistry;
    this.logger = logger;
    this.configDir = configDir;
    this.sparqlyVersion = sparqlyVersion;
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
        loaded: undefined,
        disk: undefined,
        closeIndex: undefined,
        current: undefined,
      });
    }
    return new EngineMap(
      entries,
      resolutionRegistry,
      options.logger,
      options.configDir ?? process.cwd(),
      options.sparqlyVersion,
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
    if (isDiskBackedGlob(entry.source)) {
      return this.ensureDiskBacked(entry);
    }
    if (entry.loaded === undefined) {
      entry.loaded = this.loadEntry(entry);
    }
    return new ResultAsync(entry.loaded);
  }

  /**
   * Disk-backed glob state machine (ADR-0041, #340). First touch memoizes a
   * resolution that either opens an already-built index (`ready`) or kicks a
   * background build and reports `indexing`; concurrent first-touches share
   * that one promise, so the build runs at most once.
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
    const indexDir = globIndexDir(this.configDir, sourceId);
    if (await manifestExists(indexDir)) {
      // A built index is already present — open it straight to `ready` (a
      // fast LevelDB open, not a ~15-min build), so no request sees `503`.
      return this.loadEntry(entry);
    }
    // No index yet — kick the heavy build in the background and report
    // `indexing` so `serve` answers `503` without blocking the HTTP listener.
    this.startBackgroundBuild(entry);
    return err(indexingError(sourceId));
  }

  private startBackgroundBuild(entry: Entry): void {
    const sourceId = entry.source.id as string;
    const start = Date.now();
    this.logger?.info('index-build-start', {
      source: sourceId,
      glob: (entry.source as ParsedGlobSource).glob,
    });
    const build = this.loadEntry(entry).then((result) => {
      result.match(
        (loaded) => {
          // Build done — flip the slot to `ready`; the next request reuses it.
          entry.disk = Promise.resolve(ok(loaded));
          this.logger?.info('index-build-complete', {
            source: sourceId,
            files: entry.files.length,
            ms: Date.now() - start,
          });
        },
        (error) => {
          // A failed build clears the slot — the next request retries fresh.
          entry.disk = undefined;
          this.logger?.error('index-build-failed', {
            source: sourceId,
            message: formatSourceError(error),
          });
        },
      );
    });
    this.inFlightBuilds.add(build);
    void build.finally(() => this.inFlightBuilds.delete(build));
  }

  /**
   * Resolves once no background index build is in flight (ADR-0041). Used by
   * graceful shutdown — and by tests — to await a disk-backed glob's build
   * before reading its `ready` state or releasing its LevelDB lock.
   */
  async whenIdle(): Promise<void> {
    while (this.inFlightBuilds.size > 0) {
      await Promise.all([...this.inFlightBuilds]);
    }
  }

  private async loadEntry(
    entry: Entry,
  ): Promise<Result<LoadedEntry, SourceError>> {
    const src = entry.source;
    const sourceId = src.id ?? '(source)';
    const start = Date.now();
    const resolved = await resolveSourceResult(src, {
      registry: this.resolutionRegistry,
      logger: this.logger,
      configDir: this.configDir,
      sparqlyVersion: this.sparqlyVersion,
    });
    if (resolved.isErr()) {
      // Clear memoization so the next request retries — gives the user a
      // self-healing path when they fix the underlying file/ref/config.
      entry.loaded = undefined;
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
    // Let in-flight index builds settle so their LevelDB locks are released
    // cleanly before the directories are dropped.
    await this.whenIdle();
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

/** A glob source declared `storage: disk` — hosted from a Glob index (ADR-0041). */
function isDiskBackedGlob(source: ParsedSource): source is ParsedGlobSource {
  return source.kind === 'glob' && source.storage === 'disk';
}

/** Whether a built Glob index — its `manifest.json` — exists at `indexDir`. */
async function manifestExists(indexDir: string): Promise<boolean> {
  try {
    await stat(indexManifestPath(indexDir));
    return true;
  } catch {
    return false;
  }
}
