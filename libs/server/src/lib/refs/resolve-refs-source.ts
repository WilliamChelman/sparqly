import { err, ok, type Result } from 'neverthrow';
import {
  storageTier,
  type ParsedGlobSource,
  type ParsedSource,
} from 'core';

export type RefsSourceFailure =
  | { kind: 'unknown-source' }
  | { kind: 'no-git-repo'; terminatingKind: string }
  | { kind: 'pin-unsupported'; reason: 'storage-disk' };

export interface RefsSourceResolution {
  glob: ParsedGlobSource & { id: string };
  /**
   * Set when the requested id is a split-glob file child — absolute path of
   * that file. Lets eligibility/commits scope to a single file instead of the
   * parent glob's full pattern.
   */
  filePath?: string;
}

/** Walks files up through `parentId` to find the backing glob. */
export function resolveRefsSource(
  id: string,
  registry: ReadonlyArray<ParsedSource>,
): Result<RefsSourceResolution, RefsSourceFailure> {
  return resolve(id, registry, undefined);
}

function resolve(
  id: string,
  registry: ReadonlyArray<ParsedSource>,
  filePath: string | undefined,
): Result<RefsSourceResolution, RefsSourceFailure> {
  const source = registry.find((s) => s.id === id);
  if (source === undefined) {
    return err({ kind: 'unknown-source' });
  }
  if (source.kind === 'glob') {
    return guardPinSupport(source as ParsedGlobSource & { id: string }, filePath);
  }
  if (source.kind === 'file') {
    const parent = registry.find((s) => s.id === source.parentId);
    if (parent === undefined) {
      return err({ kind: 'no-git-repo', terminatingKind: 'file' });
    }
    return resolve(source.parentId, registry, source.path);
  }
  return err({ kind: 'no-git-repo', terminatingKind: source.kind });
}

/** Refuses `storage: disk` globs — load path rejects `gitRef`, so refs would be useless. */
function guardPinSupport(
  glob: ParsedGlobSource & { id: string },
  filePath: string | undefined,
): Result<RefsSourceResolution, RefsSourceFailure> {
  if (storageTier(glob) === 'disk') {
    return err({ kind: 'pin-unsupported', reason: 'storage-disk' });
  }
  return ok(filePath === undefined ? { glob } : { glob, filePath });
}
