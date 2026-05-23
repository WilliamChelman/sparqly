import { join } from 'node:path';

// LevelDB lives under `db/` to keep the manifest plainly visible alongside
// LevelDB's own `MANIFEST-*` bookkeeping files.
export function indexDbDir(indexDir: string): string {
  return join(indexDir, 'db');
}

export function indexManifestPath(indexDir: string): string {
  return join(indexDir, 'manifest.json');
}

// Defaults to `<configDir>/.sparqly/index/<source-id>/`. `indexCacheDir`
// overrides the parent so users can redirect large indexes to another volume.
export function globIndexDir(
  configDir: string,
  sourceId: string,
  indexCacheDir?: string,
): string {
  const root = indexCacheDir ?? join(configDir, '.sparqly', 'index');
  return join(root, sourceId);
}
