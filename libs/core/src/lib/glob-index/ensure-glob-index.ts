import { ResultAsync, okAsync } from 'neverthrow';
import type { GlobLoadError } from '../sources/errors';
import { buildGlobIndexAtomic } from './atomic-build';
import type { BuildGlobIndexOptions } from './glob-index-builder';
import { inspectGlobIndexFreshness } from './index-manifest';

/**
 * Freshness-gated Glob index build (#346). The step `sparqly index` runs per
 * disk-backed source: an already-fresh index is left alone, an absent or stale
 * one is built via {@link buildGlobIndexAtomic}, and `force` rebuilds even a
 * fresh index. Unlike the query/serve open path — which reuses a stale index
 * with a `warn` and never rebuilds it (ADR-0041) — this is the explicit
 * rebuild surface, so a stale index here *is* rebuilt.
 */

export interface EnsureGlobIndexOptions extends BuildGlobIndexOptions {
  /** Rebuild even when the index is already fresh. */
  force?: boolean;
}

export type EnsureGlobIndexOutcome =
  | {
      status: 'built';
      indexDir: string;
      files: ReadonlyArray<string>;
      /** Why the build ran: no index yet, a stale one, or `force`. */
      trigger: 'absent' | 'stale' | 'forced';
      /** The change that made the index stale, when `trigger` is `stale`. */
      staleReason?: string;
    }
  | { status: 'skipped'; indexDir: string };

/**
 * Builds the Glob index at `options.indexDir` unless it is already fresh.
 * Reports `skipped` when a fresh index is left in place, `built` (with the
 * trigger) when one was rebuilt.
 */
export function ensureGlobIndex(
  options: EnsureGlobIndexOptions,
): ResultAsync<EnsureGlobIndexOutcome, GlobLoadError> {
  // `inspectGlobIndexFreshness` reads and JSON-parses the manifest — a
  // truncated/corrupt manifest throws a `SyntaxError` that would escape the
  // typed `GlobLoadError` channel if wrapped in `fromSafePromise`. Route
  // *any* freshness-inspect failure through the typed channel so callers see
  // a rendarable `glob-load` error instead of an unhandled rejection.
  return ResultAsync.fromPromise(inspectGlobIndexFreshness(options), (err) => ({
    kind: 'glob-load' as const,
    glob: Array.isArray(options.glob) ? [...options.glob] : [options.glob],
    message: err instanceof Error ? err.message : String(err),
  })).andThen((freshness) => {
    if (!options.force && freshness.verdict === 'fresh') {
      return okAsync<EnsureGlobIndexOutcome, GlobLoadError>({
        status: 'skipped',
        indexDir: options.indexDir,
      });
    }
    const trigger = options.force
      ? 'forced'
      : freshness.verdict === 'absent'
        ? 'absent'
        : 'stale';
    return buildGlobIndexAtomic(options).map<EnsureGlobIndexOutcome>(
      (built) => ({
        status: 'built',
        indexDir: built.indexDir,
        files: built.files,
        trigger,
        ...(freshness.verdict === 'stale'
          ? { staleReason: freshness.reason }
          : {}),
      }),
    );
  });
}
