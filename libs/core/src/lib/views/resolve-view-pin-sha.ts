import { okAsync, type ResultAsync } from 'neverthrow';
import type { SparqlyLogger } from 'common';
import type { ParsedSource, ParsedViewSource } from '../sources';
import type { SourceError } from '../sources';
import { defaultRepoDiscovery } from '../sources/git/pin-glob-source';
import { pinGlobSource } from '../sources/git/pin-glob-source';
import { GitCliPort } from '../sources/git/git-cli-port';
import type { GitPort } from '../sources/git/git-port';
import type { RepoDiscoveryDeps } from '../sources/git/discover-repo';
import { resolveViewLeafGlob } from './resolve-view-leaf-glob';

export interface ResolveViewPinShaOptions {
  /** Resolution root for `gitRoot:` relative overrides; defaults to `process.cwd()`. */
  configDir?: string;
  gitPort?: GitPort;
  repoDiscovery?: RepoDiscoveryDeps;
  logger?: SparqlyLogger;
}

/**
 * Resolve the SHA that identifies a *pinned view* for worker routing (ADR-0050,
 * #390). A view's `from:` chain is linear, so it bottoms out in exactly one leaf
 * glob; the view's effective pin (`fromGitRef`, propagated down the chain) is
 * resolved against that leaf's repo to a 40-char commit SHA. Keying residency by
 * this SHA means a floating ref that moved rebuilds rather than serving a stale
 * resident store, while an immutable pin reuses the resident view.
 *
 * Resolves to `undefined` — *route this on the main thread instead* — when the
 * chain doesn't terminate in a glob (e.g. an endpoint-backed view) or carries no
 * effective pin, so those keep their exact legacy behavior. A genuine git
 * failure (an unresolvable ref) surfaces as the typed {@link SourceError}.
 */
export function resolveViewPinShaResult(
  view: ParsedViewSource,
  registry: ReadonlyArray<ParsedSource>,
  options: ResolveViewPinShaOptions = {},
): ResultAsync<string | undefined, SourceError> {
  const leaf = resolveViewLeafGlob(view, registry);
  if (leaf.isErr()) return okAsync(undefined);
  const leafGlob = leaf.value;
  const effectiveRef = view.fromGitRef ?? leafGlob.gitRef;
  if (effectiveRef === undefined) return okAsync(undefined);
  return pinGlobSource(
    {
      source: { ...leafGlob, gitRef: effectiveRef, resolvedSha: undefined },
      configDir: options.configDir ?? process.cwd(),
    },
    {
      port: options.gitPort ?? new GitCliPort(),
      repoDiscovery: options.repoDiscovery ?? defaultRepoDiscovery,
      logger: options.logger,
    },
  )
    .map<string | undefined>((pinned) => pinned.resolvedSha)
    .mapErr<SourceError>((e) => e);
}
