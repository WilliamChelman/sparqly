import type { SparqlyLogger } from 'common';
import type {
  ExpandSplitGlobsDeps,
  PinnedSplitGlobWalkResult,
} from '../expand-split-globs';
import type { ParsedGlobSource } from '../source-spec';
import { GitCliPort } from './git-cli-port';
import type { GitPort } from './git-port';
import type { RepoDiscoveryDeps } from './discover-repo';
import { defaultRepoDiscovery, pinGlobSource } from './pin-glob-source';
import { walkGitTree } from './walk-git-tree';

export interface CreateGitTreeWalkerDeps {
  port?: GitPort;
  repoDiscovery?: RepoDiscoveryDeps;
  /** Absolute path to the directory the project config (or cwd) sits in. */
  configDir: string;
  logger?: SparqlyLogger;
}

/**
 * Builds the `walkGitGlob` dep for `expandSplitGlobs` (ADR-0029): runs
 * `pinGlobSource` to pin the meta's `gitRef:` against the discovered repo,
 * then walks the git tree at the resolved SHA. Failures (repo discovery,
 * unresolvable ref, multi-repo) throw — the expand path treats them as hard
 * expand-time errors.
 */
export function createGitTreeWalker(
  deps: CreateGitTreeWalkerDeps,
): NonNullable<ExpandSplitGlobsDeps['walkGitGlob']> {
  const port = deps.port ?? new GitCliPort();
  const repoDiscovery = deps.repoDiscovery ?? defaultRepoDiscovery;
  return async (meta: ParsedGlobSource): Promise<PinnedSplitGlobWalkResult> => {
    const pinned = await pinGlobSource(
      { source: meta, configDir: deps.configDir },
      { port, repoDiscovery, logger: deps.logger },
    );
    if (pinned.isErr()) {
      throw new Error(pinned.error.message);
    }
    const walked = await walkGitTree(
      {
        glob: meta.glob,
        repoRoot: pinned.value.repoRoot,
        sha: pinned.value.resolvedSha,
      },
      { gitPort: port, repoDiscovery },
    );
    if (walked.isErr()) {
      throw new Error(walked.error.message);
    }
    return {
      files: walked.value,
      repoRoot: pinned.value.repoRoot,
      ref: pinned.value.ref,
      resolvedSha: pinned.value.resolvedSha,
    };
  };
}
