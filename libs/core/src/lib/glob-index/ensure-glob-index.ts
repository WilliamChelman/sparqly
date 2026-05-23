import { ResultAsync, okAsync } from 'neverthrow';
import type { GlobLoadError } from '../sources/errors';
import { buildGlobIndexAtomic } from './atomic-build';
import type { BuildGlobIndexOptions } from './glob-index-builder';
import { inspectGlobIndexFreshness } from './index-manifest';

export interface EnsureGlobIndexOptions extends BuildGlobIndexOptions {
  force?: boolean;
}

export type EnsureGlobIndexOutcome =
  | {
      status: 'built';
      indexDir: string;
      files: ReadonlyArray<string>;
      trigger: 'absent' | 'stale' | 'forced';
      staleReason?: string;
    }
  | { status: 'skipped'; indexDir: string };

export function ensureGlobIndex(
  options: EnsureGlobIndexOptions,
): ResultAsync<EnsureGlobIndexOutcome, GlobLoadError> {
  // Route freshness-inspect failures (e.g. corrupt manifest SyntaxError) through
  // the typed channel so callers see a renderable `glob-load` error.
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
