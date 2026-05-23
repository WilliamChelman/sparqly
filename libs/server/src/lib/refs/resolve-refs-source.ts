import { err, ok, type Result } from 'neverthrow';
import {
  resolveViewLeafGlob,
  storageTier,
  type ParsedGlobSource,
  type ParsedSource,
} from 'core';

export type RefsSourceFailure =
  | { kind: 'unknown-source' }
  | { kind: 'no-git-repo'; terminatingKind: string }
  | { kind: 'pin-unsupported'; reason: 'storage-disk' };

/** Walks views down through `from:` and files up through `parentId` to find the backing glob. */
export function resolveRefsSource(
  id: string,
  registry: ReadonlyArray<ParsedSource>,
): Result<ParsedGlobSource & { id: string }, RefsSourceFailure> {
  const source = registry.find((s) => s.id === id);
  if (source === undefined) {
    return err({ kind: 'unknown-source' });
  }
  if (source.kind === 'glob') {
    return guardPinSupport(source as ParsedGlobSource & { id: string });
  }
  if (source.kind === 'view') {
    const leaf = resolveViewLeafGlob(source, registry);
    if (leaf.isOk()) return guardPinSupport(leaf.value);
    const failure = leaf.error;
    if (failure.kind === 'view-chain-unknown-upstream') {
      return err({ kind: 'no-git-repo', terminatingKind: 'view' });
    }
    return err({ kind: 'no-git-repo', terminatingKind: failure.terminatingKind });
  }
  if (source.kind === 'file') {
    const parent = registry.find((s) => s.id === source.parentId);
    if (parent === undefined) {
      return err({ kind: 'no-git-repo', terminatingKind: 'file' });
    }
    return resolveRefsSource(source.parentId, registry);
  }
  return err({ kind: 'no-git-repo', terminatingKind: source.kind });
}

/** Refuses `storage: disk` globs — load path rejects `gitRef`, so refs would be useless. */
function guardPinSupport(
  glob: ParsedGlobSource & { id: string },
): Result<ParsedGlobSource & { id: string }, RefsSourceFailure> {
  if (storageTier(glob) === 'disk') {
    return err({ kind: 'pin-unsupported', reason: 'storage-disk' });
  }
  return ok(glob);
}
