import { stat } from 'node:fs/promises';
import {
  indexManifestPath,
  storageTier,
  type ParsedFileSource,
  type ParsedGlobSource,
  type ParsedSource,
} from 'core';

// A `storage: disk` glob or a split-glob File child that inherited the tier.
export function isDiskBacked(
  source: ParsedSource,
): source is ParsedGlobSource | ParsedFileSource {
  return (
    (source.kind === 'glob' || source.kind === 'file') &&
    storageTier(source) === 'disk'
  );
}

/** Whether a built Glob index — its `manifest.json` — exists at `indexDir`. */
export async function manifestExists(indexDir: string): Promise<boolean> {
  try {
    await stat(indexManifestPath(indexDir));
    return true;
  } catch {
    return false;
  }
}
