import { existsSync } from 'node:fs';
import {
  DEFAULT_QUERY_CACHE_TTL_MS,
  openQueryCache,
  queryCacheDbPath,
  queryCacheDir,
  type QueryCache,
  type QueryCacheStats,
} from 'core';
import { cliVersion } from '../cli-version';
import { configureLogger } from '../logging';
import { verbosityFieldsFor } from '../runner/fields/fields-shared';
import type { CommandSpec } from '../runner/fields/spec';

interface CacheConfig {
  verbose?: boolean;
  quiet?: boolean;
  logFormat?: 'text' | 'json';
}

/** The empty summary reported when no store file exists yet. */
const EMPTY_STATS: QueryCacheStats = {
  entryCount: 0,
  totalBytes: 0,
  perSource: [],
};

/**
 * Opens the on-disk Query cache for a lifecycle command and runs `body` against
 * it, always releasing the SQLite handle. Returns `undefined` without opening
 * (so no empty store is created as a side effect) when no store file exists yet
 * — an absent cache is simply empty.
 */
function withCache<T>(body: (cache: QueryCache) => T): T | undefined {
  const dir = queryCacheDir(process.cwd());
  if (!existsSync(queryCacheDbPath(dir))) return undefined;
  const cache = openQueryCache({
    dir,
    schemaVersion: cliVersion(),
    ttlMs: DEFAULT_QUERY_CACHE_TTL_MS,
  });
  try {
    return body(cache);
  } finally {
    cache.close();
  }
}

/** Renders a {@link QueryCacheStats} as tab-separated lines (mirrors `index`). */
function renderStats(stats: QueryCacheStats): string {
  const lines = [`entries\t${stats.entryCount}`, `bytes\t${stats.totalBytes}`];
  for (const s of stats.perSource) {
    lines.push(`source\t${s.sourceId}\t${s.entryCount}\t${s.totalBytes}`);
  }
  return lines.join('\n') + '\n';
}

export const cacheStatsSpec: CommandSpec<CacheConfig> = {
  name: 'cache stats',
  description:
    'Report the on-disk Query cache (ADR-0054): total entry count, summed body bytes, and a per-source breakdown ordered by descending bytes.',
  fields: [...verbosityFieldsFor('cache stats')],
  configScope: { sources: false },
  exitCode: () => 1,
  handler: () => {
    const stats = withCache((cache) => cache.stats()) ?? EMPTY_STATS;
    process.stdout.write(renderStats(stats));
  },
};

export const cacheClearSpec: CommandSpec<CacheConfig> = {
  name: 'cache clear',
  description:
    'Empty the on-disk Query cache (ADR-0054): remove every cached result across all sources.',
  fields: [...verbosityFieldsFor('cache clear')],
  configScope: { sources: false },
  exitCode: () => 1,
  handler: (config) => {
    configureLogger({
      verbose: config.verbose === true,
      quiet: config.quiet === true,
      logFormat: config.logFormat,
    });
    const cleared = withCache((cache) => {
      const { entryCount } = cache.stats();
      cache.clear();
      return entryCount;
    });
    process.stdout.write(`cleared ${cleared ?? 0} entries\n`);
  },
};
