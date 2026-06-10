import type { SparqlyLogger } from 'common';
import {
  CachingQueryExecutor,
  DEFAULT_QUERY_CACHE_TTL_MS,
  digestContext,
  openQueryCache,
  queryCacheDir,
  type ParsedSource,
  type QueryCache,
  type QueryExecutor,
} from 'core';

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
  ) {
    this.schemaVersion = sparqlyVersion ?? '0.0.0+unknown';
  }

  /** Wraps an opted-in endpoint's executor; passes everything else through. */
  wrap(source: ParsedSource | undefined, engine: QueryExecutor): QueryExecutor {
    if (
      source === undefined ||
      source.kind !== 'endpoint' ||
      source.queryCache !== true
    ) {
      return engine;
    }
    return new CachingQueryExecutor({
      delegate: engine,
      cache: this.store(),
      sourceId: source.id ?? source.endpoint,
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
      });
    }
    return this.handle;
  }
}
