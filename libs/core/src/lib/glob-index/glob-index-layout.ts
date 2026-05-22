import { join } from 'node:path';

/**
 * On-disk layout of a Glob index directory (ADR-0041). A `storage: disk`
 * glob's index lives under one container directory holding two artifacts:
 * the embedded LevelDB quad store and the {@link GlobIndexManifest}. Keeping
 * the LevelDB files in a `db/` subdirectory leaves the manifest plainly
 * visible and clear of LevelDB's own `MANIFEST-*` bookkeeping files.
 */

/** Subdirectory holding the embedded LevelDB-backed quad store. */
export function indexDbDir(indexDir: string): string {
  return join(indexDir, 'db');
}

/** Path of the JSON manifest written alongside the quad store. */
export function indexManifestPath(indexDir: string): string {
  return join(indexDir, 'manifest.json');
}

/**
 * Resolves the Glob index directory for a disk-backed source (ADR-0041):
 * `<configDir>/.sparqly/index/<source-id>/`. One directory per source id, so
 * sibling disk-backed globs never share an index.
 *
 * When `indexCacheDir` is supplied (the config-overridable cache root, #345),
 * it replaces `<configDir>/.sparqly/index` as the parent — so the index lands
 * at `<indexCacheDir>/<source-id>/`, letting a user redirect large indexes to
 * a chosen volume.
 */
export function globIndexDir(
  configDir: string,
  sourceId: string,
  indexCacheDir?: string,
): string {
  const root = indexCacheDir ?? join(configDir, '.sparqly', 'index');
  return join(root, sourceId);
}
