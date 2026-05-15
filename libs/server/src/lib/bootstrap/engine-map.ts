import type { SparqlyLogger } from 'common';
import { QueryEngine, resolveSource, type ParsedSource } from 'core';
import type { StoreRef } from './tokens';

interface Entry {
  source: ParsedSource;
  engine: QueryEngine;
  storeRef: StoreRef | undefined;
  /**
   * Absolute paths the loader actually opened for this source on its most
   * recent materialized resolution. Empty for pass-through (endpoint) sources
   * or anything else that did not touch the filesystem. Refreshed by
   * `setFiles` after watcher rebuilds so the snippet allow-list can be
   * recomputed atomically.
   */
  files: string[];
}

export interface EngineMapOptions {
  /**
   * Registry used to resolve `from:` chains while building engines — a superset
   * of the served set. Defaults to the served registry when omitted.
   */
  resolutionRegistry?: ReadonlyArray<ParsedSource>;
  /**
   * Boundary logger threaded into each source's {@link QueryEngine} (and into
   * `resolveSource` for view chains) so `serve`'s SPARQL executions emit the
   * shared `query` debug event under `--verbose` (ADR-0020). Also emits a
   * `source-loaded` debug line per source with its load timing. Defaults to none.
   */
  logger?: SparqlyLogger;
}

export class EngineMap {
  private readonly entries: Map<string, Entry>;

  private constructor(entries: Map<string, Entry>) {
    this.entries = entries;
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
      const start = Date.now();
      const entry = await buildEntry(src, resolutionRegistry, options.logger);
      entries.set(src.id, entry);
      const ms = Date.now() - start;
      if (entry.storeRef) {
        options.logger?.debug('source-loaded', {
          source: src.id,
          kind: src.kind,
          files: entry.files.length,
          quads: entry.storeRef.current.size,
          ms,
        });
      } else {
        options.logger?.debug('source-loaded', {
          source: src.id,
          kind: src.kind,
          ms,
        });
      }
    }
    return new EngineMap(entries);
  }

  allIds(): string[] {
    return Array.from(this.entries.keys());
  }

  get(id: string): QueryEngine {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`EngineMap: no source with @id "${id}"`);
    return entry.engine;
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
    return this.entries.get(id)?.storeRef;
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

async function buildEntry(
  source: ParsedSource,
  registry: ReadonlyArray<ParsedSource>,
  logger: SparqlyLogger | undefined,
): Promise<Entry> {
  const sourceId = source.id ?? '(source)';
  if (source.kind === 'endpoint') {
    return {
      source,
      engine: new QueryEngine(source, {
        id: source.id ?? source.endpoint,
        mode: 'pass-through',
        logger,
      }),
      storeRef: undefined,
      files: [],
    };
  }
  const resolved = await resolveSource(source, { registry, logger });
  if (resolved.mode === 'pass-through') {
    return {
      source,
      engine: new QueryEngine(resolved.endpoint, {
        id: source.id ?? resolved.endpoint.endpoint,
        mode: 'pass-through',
        logger,
      }),
      storeRef: undefined,
      files: [],
    };
  }
  const storeRef: StoreRef = { current: resolved.store };
  const ref = storeRef;
  return {
    source,
    engine: new QueryEngine(() => ref.current, {
      id: sourceId,
      mode: source.kind === 'view' ? 'view' : 'materialized',
      logger,
    }),
    storeRef,
    files: [...resolved.files],
  };
}
