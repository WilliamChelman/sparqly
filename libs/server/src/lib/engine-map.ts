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
  onSourceLoaded?: (id: string, kind: ParsedSource['kind'], ms: number) => void;
}

export class EngineMap {
  private readonly entries: Map<string, Entry>;

  private constructor(entries: Map<string, Entry>) {
    this.entries = entries;
  }

  static async create(
    registry: ReadonlyArray<ParsedSource>,
    options: EngineMapOptions = {},
  ): Promise<EngineMap> {
    const entries = new Map<string, Entry>();
    for (const src of registry) {
      if (src.kind === 'reference') continue;
      if (src.id === undefined) continue;
      const start = Date.now();
      const entry = await buildEntry(src, registry);
      entries.set(src.id, entry);
      options.onSourceLoaded?.(src.id, src.kind, Date.now() - start);
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
): Promise<Entry> {
  if (source.kind === 'endpoint') {
    return {
      source,
      engine: new QueryEngine(source),
      storeRef: undefined,
      files: [],
    };
  }
  const resolved = await resolveSource(source, { registry });
  if (resolved.mode === 'pass-through') {
    return {
      source,
      engine: new QueryEngine(resolved.endpoint),
      storeRef: undefined,
      files: [],
    };
  }
  const storeRef: StoreRef = { current: resolved.store };
  const ref = storeRef;
  return {
    source,
    engine: new QueryEngine(() => ref.current),
    storeRef,
    files: [...resolved.files],
  };
}
