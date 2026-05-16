import { err, ok, ResultAsync, type Result } from 'neverthrow';
import type { SparqlyLogger } from 'common';
import {
  QueryEngine,
  resolveSourceResult,
  type ParsedEndpointSource,
  type ParsedSource,
  type SourceError,
  type SourceRecordSidecar,
} from 'core';
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
  | { mode: 'pass-through'; endpoint: ParsedEndpointSource };

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
   */
  loaded: Promise<Result<LoadedEntry, SourceError>> | undefined;
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
   * first `ensure(id)`, not at boot.
   */
  logger?: SparqlyLogger;
}

export class EngineMap {
  private readonly entries: Map<string, Entry>;
  private readonly resolutionRegistry: ReadonlyArray<ParsedSource>;
  private readonly logger: SparqlyLogger | undefined;

  private constructor(
    entries: Map<string, Entry>,
    resolutionRegistry: ReadonlyArray<ParsedSource>,
    logger: SparqlyLogger | undefined,
  ) {
    this.entries = entries;
    this.resolutionRegistry = resolutionRegistry;
    this.logger = logger;
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
          current: loaded,
        });
        continue;
      }
      entries.set(src.id, {
        source: src,
        files: [],
        loaded: undefined,
        current: undefined,
      });
    }
    return new EngineMap(entries, resolutionRegistry, options.logger);
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
   */
  ensure(id: string): ResultAsync<QueryEngine, SourceError> {
    return this.ensureEntry(id).map((loaded) => loaded.engine);
  }

  /**
   * Triggers the same one-shot lazy load as {@link ensure} but returns the
   * resolved {@link LoadedSources} discriminant — the diff service uses this
   * to read the loader-attached source-record sidecar (ADR-0032) without
   * touching the engine.
   */
  ensureSources(id: string): ResultAsync<LoadedSources, SourceError> {
    return this.ensureEntry(id).map((loaded) => loaded.sources);
  }

  private ensureEntry(id: string): ResultAsync<LoadedEntry, SourceError> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`EngineMap: no source with @id "${id}"`);
    if (entry.loaded === undefined) {
      entry.loaded = this.loadEntry(entry);
    }
    return new ResultAsync(entry.loaded);
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
    } else {
      const storeRef: StoreRef = { current: sources.store };
      const ref = storeRef;
      loaded = {
        engine: new QueryEngine(() => ref.current, {
          id: sourceId,
          mode: src.kind === 'view' ? 'view' : 'materialized',
          logger: this.logger,
        }),
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
    this.entries.clear();
  }
}
