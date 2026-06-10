import type { SparqlyLogger } from 'common';
import {
  CachingQueryExecutor,
  DEFAULT_QUERY_CACHE_TTL_MS,
  digestContext,
  endpointQueryCacheCap,
  openQueryCache,
  queryCacheDir,
  type ParsedSource,
  type QueryCache,
  type QueryExecutor,
} from 'core';

/** The Query cache's global byte budget for a `serve` process (ADR-0054). */
export interface ServeQueryCacheBudget {
  /** Global byte budget; `null` is explicitly unbounded; omitted uses the default. */
  maxBytes?: number | null;
  /** Per-entry ceiling; a larger result bypasses the cache; omitted uses the default. */
  maxEntryBytes?: number;
}

/**
 * The lazily-opened shared Query cache for a `serve` EngineMap (ADR-0054). One
 * on-disk store serves every request; it is created on the first touch of an
 * opted-in source and closed on shutdown. {@link wrap} returns the bare engine
 * untouched for any source that did not opt in, so nothing is created or read.
 */
export class ServeQueryCache {
  private handle: QueryCache | undefined;
  private readonly schemaVersion: string;

  constructor(
    private readonly configDir: string,
    sparqlyVersion: string | undefined,
    private readonly logger: SparqlyLogger | undefined,
    private readonly budget: ServeQueryCacheBudget = {},
  ) {
    this.schemaVersion = sparqlyVersion ?? '0.0.0+unknown';
  }

  /** Wraps an opted-in endpoint's executor; passes everything else through. */
  wrap(source: ParsedSource | undefined, engine: QueryExecutor): QueryExecutor {
    if (
      source === undefined ||
      source.kind !== 'endpoint' ||
      source.queryCache === undefined
    ) {
      return engine;
    }
    return new CachingQueryExecutor({
      delegate: engine,
      cache: this.store(),
      sourceId: source.id ?? source.endpoint,
      sourceMaxBytes: endpointQueryCacheCap(source.queryCache),
      // `serve` serializes without project prefixes/base today, so the display
      // context is empty here; a later slice threads it through if that changes.
      contextDigest: digestContext({}),
      schemaVersion: this.schemaVersion,
      mode: 'normal',
      logger: this.logger,
    });
  }

  close(): void {
    this.handle?.close();
    this.handle = undefined;
  }

  private store(): QueryCache {
    if (this.handle === undefined) {
      this.handle = openQueryCache({
        dir: queryCacheDir(this.configDir),
        schemaVersion: this.schemaVersion,
        ttlMs: DEFAULT_QUERY_CACHE_TTL_MS,
        maxBytes: this.budget.maxBytes,
        maxEntryBytes: this.budget.maxEntryBytes,
        logger: this.logger,
      });
    }
    return this.handle;
  }
}
