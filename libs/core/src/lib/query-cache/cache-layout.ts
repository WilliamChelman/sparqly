import { join } from 'node:path';

/**
 * The Query cache lives under `<configDir>/.sparqly/cache/`, a peer of the Glob
 * index's `.sparqly/index/`. One SQLite file holds every source's entries — the
 * key folds the source id, so a single shared store needs no per-source subdir.
 */
export function queryCacheDir(configDir: string): string {
  return join(configDir, '.sparqly', 'cache');
}

export function queryCacheDbPath(cacheDir: string): string {
  return join(cacheDir, 'results.db');
}
