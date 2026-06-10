import { okAsync, type ResultAsync } from 'neverthrow';
import { noopLogger, type SparqlyLogger } from 'common';
import type { ExecuteOptions, ExecuteResult, QueryExecutor } from '../engine';
import type {
  EndpointFetchError,
  QueryExecutionError,
} from '../sources/errors';
import { deriveCacheKey } from './cache-key';
import type { QueryCache } from './cache-store';

/**
 * The seam's mode (ADR-0054). Only `normal` is wired in slice 1; `bypass` and
 * `refresh` are surfaced for later slices' `--no-cache` / `--refresh` controls.
 * - `normal` — read-through: serve a hit, else execute and store.
 * - `bypass` — neither read nor write the cache.
 * - `refresh` — ignore any stored entry, execute, then replace it.
 */
export type CacheMode = 'normal' | 'bypass' | 'refresh';

export interface CachingQueryExecutorOptions {
  /** The executor whose results are cached (the bare endpoint engine). */
  delegate: QueryExecutor;
  cache: QueryCache;
  /** The {@link target source}'s id — a key component and the per-source cap owner. */
  sourceId: string;
  /**
   * This source's optional per-source byte cap (ADR-0054), forwarded to the
   * store on `set`. `undefined` leaves the source under the global budget alone.
   */
  sourceMaxBytes?: number | null;
  /** Digest of the display {@link context} (prefixes/base) — a key component. */
  contextDigest: string;
  /**
   * Path-aware freshness token (ADR-0054, #415) — a content fingerprint of the
   * source folded into the key so an underlying change is a miss. Empty for
   * opaque endpoints (TTL-bounded). Defaults to empty when omitted.
   */
  freshnessToken?: string;
  /** Cache-schema version — a key component. */
  schemaVersion: string;
  mode?: CacheMode;
  logger?: SparqlyLogger;
}

type ExecuteError = QueryExecutionError | EndpointFetchError;

/**
 * Wraps a {@link QueryExecutor} with the read-through Query cache (ADR-0054).
 * On a hit it returns the stored body tagged `cacheStatus: 'hit'` without
 * touching the delegate; on a miss it executes, stores the body (never an
 * error — a failed execution propagates before `set`; an empty body is a
 * legitimate result and is cached), and tags `cacheStatus: 'miss'`.
 */
export class CachingQueryExecutor implements QueryExecutor {
  private readonly delegate: QueryExecutor;
  private readonly cache: QueryCache;
  private readonly sourceId: string;
  private readonly sourceMaxBytes?: number | null;
  private readonly contextDigest: string;
  private readonly freshnessToken: string;
  private readonly schemaVersion: string;
  private readonly mode: CacheMode;
  private readonly logger: SparqlyLogger;

  constructor(options: CachingQueryExecutorOptions) {
    this.delegate = options.delegate;
    this.cache = options.cache;
    this.sourceId = options.sourceId;
    this.sourceMaxBytes = options.sourceMaxBytes;
    this.contextDigest = options.contextDigest;
    this.freshnessToken = options.freshnessToken ?? '';
    this.schemaVersion = options.schemaVersion;
    this.mode = options.mode ?? 'normal';
    this.logger = options.logger ?? noopLogger;
  }

  executeResult(
    query: string,
    options: ExecuteOptions = {},
  ): ResultAsync<ExecuteResult, ExecuteError> {
    if (this.mode === 'bypass') {
      return this.delegate
        .executeResult(query, options)
        .map((result) => ({ ...result, cacheStatus: 'bypass' as const }));
    }
    const key = this.keyFor(query, options);
    if (this.mode === 'normal') {
      const hit = this.cache.get(key);
      if (hit !== undefined) {
        this.log('hit', key);
        return okAsync({
          body: hit.body,
          format: hit.format as ExecuteResult['format'],
          contentType: hit.contentType,
          cacheStatus: 'hit',
        });
      }
    }
    return this.delegate.executeResult(query, options).map((result) => {
      this.store(key, result);
      this.log('miss', key);
      return { ...result, cacheStatus: 'miss' as const };
    });
  }

  async execute(
    query: string,
    options: ExecuteOptions = {},
  ): Promise<ExecuteResult> {
    if (this.mode === 'bypass') {
      return {
        ...(await this.delegate.execute(query, options)),
        cacheStatus: 'bypass',
      };
    }
    const key = this.keyFor(query, options);
    if (this.mode === 'normal') {
      const hit = this.cache.get(key);
      if (hit !== undefined) {
        this.log('hit', key);
        return {
          body: hit.body,
          format: hit.format as ExecuteResult['format'],
          contentType: hit.contentType,
          cacheStatus: 'hit',
        };
      }
    }
    // A throw here propagates before `store` — errors are never cached.
    const result = await this.delegate.execute(query, options);
    this.store(key, result);
    this.log('miss', key);
    return { ...result, cacheStatus: 'miss' };
  }

  private keyFor(query: string, options: ExecuteOptions): string {
    return deriveCacheKey({
      sourceId: this.sourceId,
      query,
      // Verbatim requested format token (empty when the caller defaulted it);
      // stable per request, so the key is reproducible across invocations.
      format: options.format ?? '',
      contextDigest: this.contextDigest,
      freshnessToken: this.freshnessToken,
      schemaVersion: this.schemaVersion,
    });
  }

  private store(key: string, result: ExecuteResult): void {
    this.cache.set(key, result.body, {
      format: result.format,
      contentType: result.contentType,
      sourceId: this.sourceId,
      sourceMaxBytes: this.sourceMaxBytes,
    });
  }

  private log(status: 'hit' | 'miss', key: string): void {
    if (this.logger === noopLogger) return;
    this.logger.debug('query-cache', { source: this.sourceId, status, key });
  }
}
