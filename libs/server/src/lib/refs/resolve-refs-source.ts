import { err, ok, type Result } from 'neverthrow';
import {
  resolveViewLeafGlob,
  type ParsedGlobSource,
  type ParsedSource,
} from 'core';

/**
 * Result of resolving `/api/sources/:id/refs` to the glob whose repo's refs
 * should be listed. `unknown-source` means no such id is registered;
 * `no-git-repo` means the source (or, for a view, its `from:` chain) bottoms
 * on a kind without an associated git repo.
 */
export type RefsSourceFailure =
  | { kind: 'unknown-source' }
  | { kind: 'no-git-repo'; terminatingKind: string };

/**
 * Locate the glob whose repo backs ref-discovery for a given source id.
 *
 * For a `kind: 'glob'` source the source itself is returned. For a
 * `kind: 'view'` source the resolver walks the `from:` chain (delegating to
 * core's view-chain walker) and returns the leaf glob. For a `kind: 'file'`
 * source (synthesized split-glob child, ADR-0027) the resolver walks up
 * `parentId` and recurses — symmetric to the view down-walk, so a file →
 * glob chain resolves to the parent glob's repo. If any chain bottoms on a
 * non-glob kind the failure names that kind for the controller's 404 payload.
 *
 * Deep — callers receive either a glob source or a `terminatingKind` they
 * can put in the response body; they do not reason about chain shape.
 */
export function resolveRefsSource(
  id: string,
  registry: ReadonlyArray<ParsedSource>,
): Result<ParsedGlobSource & { id: string }, RefsSourceFailure> {
  const source = registry.find((s) => s.id === id);
  if (source === undefined) {
    return err({ kind: 'unknown-source' });
  }
  if (source.kind === 'glob') {
    return ok(source as ParsedGlobSource & { id: string });
  }
  if (source.kind === 'view') {
    const leaf = resolveViewLeafGlob(source, registry);
    if (leaf.isOk()) return ok(leaf.value);
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
