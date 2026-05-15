import { dirname, isAbsolute, relative, sep } from 'node:path';
import picomatch = require('picomatch');
import { errAsync, ResultAsync } from 'neverthrow';
import type { GitPort } from './git-port';
import type { RepoDiscoveryDeps } from './discover-repo';

export interface WalkGitTreeArgs {
  /**
   * Absolute glob pattern (the same shape `tinyglobby` is invoked with on the
   * working-tree path). The walker rebases it to repo-relative before matching
   * against {@link GitPort.listFilesAtSha} output.
   */
  glob: string;
  /** Absolute repo root the glob was discovered against. */
  repoRoot: string;
  /** Resolved 40-char commit SHA. */
  sha: string;
}

export interface WalkGitTreeDeps {
  gitPort: GitPort;
  /**
   * Per-match repo discovery — used to enforce the single-repo invariant
   * (ADR-0029). When a matched path's containing repo (walked up from its
   * directory) differs from {@link WalkGitTreeArgs.repoRoot}, the walker
   * surfaces a typed `spans-multiple-repos` error naming both repo paths.
   */
  repoDiscovery: RepoDiscoveryDeps;
}

/**
 * Failure modes for the git-tree walker (ADR-0029). `glob-outside-repo` flags a
 * structural mismatch — the glob's base sits above or aside the discovered
 * repo root. `spans-multiple-repos` flags a per-match violation — at least one
 * matched path falls under a nested `.git` inside `repoRoot`.
 */
export type WalkGitTreeError =
  | {
      kind: 'glob-outside-repo';
      glob: string;
      repoRoot: string;
      message: string;
    }
  | {
      kind: 'spans-multiple-repos';
      expectedRepo: string;
      foundRepo: string;
      matchPath: string;
      message: string;
    };

/**
 * Enumerates the files in the git tree at `sha` that match `glob`, returning
 * absolute paths under `repoRoot` (the same shape the production
 * `tinyglobby`-backed walker emits on the working tree). The single-repo
 * invariant is enforced two ways: structurally (one repo per call) and
 * per-match (each result must live under the same repo as `repoRoot`).
 */
export function walkGitTree(
  args: WalkGitTreeArgs,
  deps: WalkGitTreeDeps,
): ResultAsync<ReadonlyArray<string>, WalkGitTreeError> {
  const rebased = rebaseGlobToRepo(args.glob, args.repoRoot);
  if (rebased === null) {
    return errAsync<ReadonlyArray<string>, WalkGitTreeError>({
      kind: 'glob-outside-repo',
      glob: args.glob,
      repoRoot: args.repoRoot,
      message: `glob ${JSON.stringify(args.glob)} is outside repo root ${args.repoRoot}; a pinned glob must resolve under a single git repository`,
    });
  }
  const matcher = picomatch(rebased, { dot: false });
  const listing = deps.gitPort.listFilesAtSha(args.repoRoot, args.sha);
  return ResultAsync.fromSafePromise(listing).andThen((paths) => {
    const matched = paths
      .filter((p) => matcher(p))
      .map((p) => ({ rel: p, abs: joinRepoPath(args.repoRoot, p) }));
    for (const { abs } of matched) {
      const containingRepo = discoverContainingRepo(
        dirname(abs),
        deps.repoDiscovery,
      );
      if (containingRepo !== null && containingRepo !== args.repoRoot) {
        return errAsync<ReadonlyArray<string>, WalkGitTreeError>({
          kind: 'spans-multiple-repos',
          expectedRepo: args.repoRoot,
          foundRepo: containingRepo,
          matchPath: abs,
          message: `pinned glob matches span multiple git repositories: ${args.repoRoot} and ${containingRepo} (e.g. ${abs}). Configure a single \`gitRoot\` or narrow the glob`,
        });
      }
    }
    const out: ReadonlyArray<string> = matched.map((m) => m.abs);
    return ResultAsync.fromSafePromise<ReadonlyArray<string>, WalkGitTreeError>(
      Promise.resolve(out),
    );
  });
}

function rebaseGlobToRepo(glob: string, repoRoot: string): string | null {
  if (!isAbsolute(glob)) {
    return glob.split(sep).join('/');
  }
  const rel = relative(repoRoot, glob);
  if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`)) {
    return null;
  }
  return rel.split(sep).join('/');
}

function joinRepoPath(repoRoot: string, repoRelPath: string): string {
  const native = repoRelPath.split('/').join(sep);
  return repoRoot.endsWith(sep) ? `${repoRoot}${native}` : `${repoRoot}${sep}${native}`;
}

function discoverContainingRepo(
  startDir: string,
  deps: RepoDiscoveryDeps,
): string | null {
  let cur = startDir;
  while (true) {
    if (deps.hasGitDir(cur)) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}
