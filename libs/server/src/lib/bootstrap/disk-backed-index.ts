import { stat } from 'node:fs/promises';
import {
  indexManifestPath,
  storageTier,
  type ParsedFileSource,
  type ParsedGlobSource,
  type ParsedSource,
} from 'core';

/**
 * Whether a source materializes onto the disk tier (ADR-0041) — a `storage:
 * disk` glob, or a split-glob File child that inherited the tier (#344). Both
 * run the same background-build state machine; only the Glob index pattern
 * differs (the glob's pattern vs. the child's single file path).
 */
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
