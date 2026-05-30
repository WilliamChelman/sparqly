import type { ResultAsync } from 'neverthrow';
import type { SparqlyLogger } from 'common';
import type { SourceError } from '../errors';
import type { ParsedGlobSource } from '../source-spec';
import type { RepoDiscoveryDeps } from './discover-repo';
import { GitCliPort } from './git-cli-port';
import type { GitPort } from './git-port';
import { defaultRepoDiscovery, pinGlobSource } from './pin-glob-source';

export interface ResolveGlobPinShaOptions {
  /** Resolution root for `gitRoot:` relative overrides; defaults to `process.cwd()`. */
  configDir?: string;
  gitPort?: GitPort;
  repoDiscovery?: RepoDiscoveryDeps;
  logger?: SparqlyLogger;
}

/**
 * Resolve a glob source's `gitRef:` to its 40-char commit SHA *without*
 * materializing the store (ADR-0050, #390). This is the cheap main-thread key
 * the query worker pool needs to route an ad-hoc pinned source to its sticky
 * worker and to bound its per-worker LRU residency by resolved SHA — so a
 * floating ref that moved rebuilds rather than serving a stale resident store.
 *
 * Mirrors {@link resolveSourceResult}'s lazy port construction: pass `gitPort`
 * to inject a stub in tests, otherwise a default `git`-CLI port is used.
 */
export function resolveGlobPinShaResult(
  source: ParsedGlobSource,
  options: ResolveGlobPinShaOptions = {},
): ResultAsync<string, SourceError> {
  return pinGlobSource(
    { source, configDir: options.configDir ?? process.cwd() },
    {
      port: options.gitPort ?? new GitCliPort(),
      repoDiscovery: options.repoDiscovery ?? defaultRepoDiscovery,
      logger: options.logger,
    },
  )
    .map((pinned) => pinned.resolvedSha)
    .mapErr<SourceError>((e) => e);
}
