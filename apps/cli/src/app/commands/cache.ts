import { resolve as resolvePath } from 'node:path';
import { z } from 'zod';
import {
  clearCacheDir,
  DEFAULT_CACHE_DIR_NAME,
  listCachedEntries,
  removeCacheEntry,
  type CachedEntrySummary,
} from 'core';
import { configureLogger } from '../logging';
import type { FieldDescriptor } from '../runner/field';
import { verbosityFieldsFor } from '../runner/fields-shared';
import type { CommandSpec } from '../runner/spec';

interface CacheCommandConfig {
  cacheDir?: string;
  id?: string;
  verbose?: boolean;
  quiet?: boolean;
}

class UnknownCacheIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownCacheIdError';
  }
}

const cacheDirField: FieldDescriptor = {
  key: 'cacheDir',
  schema: z.string(),
  env: ['SPARQLY_CACHE_DIR'],
  flags: [
    {
      spec: '--cache-dir <path>',
      description: `Cache directory to operate on (default: ./${DEFAULT_CACHE_DIR_NAME}).`,
    },
  ],
};

const idField: FieldDescriptor = {
  key: 'id',
  schema: z.string().min(1),
};

function resolveCacheDir(config: CacheCommandConfig): string {
  const raw = config.cacheDir ?? DEFAULT_CACHE_DIR_NAME;
  return resolvePath(process.cwd(), raw);
}

function formatAge(ageMs: number): string {
  if (ageMs < 1000) return `${ageMs}ms`;
  const s = Math.floor(ageMs / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)}KiB`;
  const mib = kib / 1024;
  return `${mib.toFixed(1)}MiB`;
}

function renderEntry(entry: CachedEntrySummary): string {
  return [
    entry.id,
    entry.strategy,
    formatSize(entry.sizeBytes),
    formatAge(entry.ageMs),
    entry.freshness,
  ].join('\t');
}

export const cacheListSpec: CommandSpec<CacheCommandConfig> = {
  name: 'cache list',
  description:
    'List cached view entries under the configured cacheDir (id, strategy, size, age, freshness).',
  fields: [cacheDirField, ...verbosityFieldsFor('cache')],
  configScope: { sources: false, block: 'cache' },
  exitCode: () => 1,
  handler: async (config) => {
    configureLogger({
      verbose: config.verbose === true,
      quiet: config.quiet === true,
    });
    const cacheDir = resolveCacheDir(config);
    const entries = await listCachedEntries(cacheDir);
    if (entries.length === 0) return;
    const body =
      entries.map(renderEntry).join('\n') + '\n';
    process.stdout.write(body);
  },
};

export const cacheClearSpec: CommandSpec<CacheCommandConfig> = {
  name: 'cache clear',
  description:
    'Remove cached view entries under the configured cacheDir. Pass an id to remove a single entry; this is the only way to bust an `everlasting` view.',
  fields: [cacheDirField, idField, ...verbosityFieldsFor('cache')],
  positionals: [{ field: 'id', name: 'id' }],
  configScope: { sources: false, block: 'cache' },
  exitCode: (err) => (err instanceof UnknownCacheIdError ? 1 : 1),
  handler: async (config) => {
    configureLogger({
      verbose: config.verbose === true,
      quiet: config.quiet === true,
    });
    const cacheDir = resolveCacheDir(config);
    if (typeof config.id === 'string') {
      try {
        await removeCacheEntry(cacheDir, config.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new UnknownCacheIdError(message);
      }
      return;
    }
    await clearCacheDir(cacheDir);
  },
};

export { UnknownCacheIdError };
