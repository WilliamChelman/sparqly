import { existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ResultAsync, errAsync } from 'neverthrow';
import {
  discoverRepoRoot,
  type DiscoverRepoError,
  type RepoDiscoveryDeps,
} from './discover-repo';
import type { GitPinError } from '../errors';
import type { GitPort } from './git-port';
import { resolveGitRefToSha } from './resolve-ref';
import type { ParsedGlobSource } from '../source-spec';

export interface PinnedGlob {
  /** Absolute path to the repo root used for `git -C`. */
  repoRoot: string;
  /** Resolved 40-char commit SHA. */
  resolvedSha: string;
  /** The user-facing ref string (as typed by the user). */
  ref: string;
  /**
   * Per-file content reader for the load path: maps a working-tree absolute
   * path to the file bytes from the git tree at {@link resolvedSha}. Returns
   * the file content; returning `null` is reserved for the future
   * "file absent at that revision" case (slice 1 surfaces missing files as
   * a hard error via {@link PinnedFileMissingError}).
   */
  contentReader: (absolutePath: string) => Promise<Buffer | null>;
}

export interface PinGlobSourceDeps {
  port: GitPort;
  repoDiscovery: RepoDiscoveryDeps;
}

export interface PinGlobSourceArgs {
  source: ParsedGlobSource;
  /** Absolute path to the directory the config (or cwd) sits in. */
  configDir: string;
}

/**
 * Default {@link RepoDiscoveryDeps} backed by the local filesystem.
 */
export const defaultRepoDiscovery: RepoDiscoveryDeps = {
  hasGitDir(dir: string): boolean {
    const candidate = join(dir, '.git');
    if (!existsSync(candidate)) return false;
    try {
      return statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  },
};

/**
 * Resolves a glob source's `gitRef:` to a concrete repo root + commit SHA and
 * returns a {@link PinnedGlob} the load path can wire into
 * {@link loadRdfResult} via its `contentReader` option (ADR-0029).
 *
 * Errors are returned as typed {@link GitPinError} values (canonical shape
 * shared with the rest of the source-error union); callers map them to
 * surface-specific error variants.
 */
export function pinGlobSource(
  args: PinGlobSourceArgs,
  deps: PinGlobSourceDeps,
): ResultAsync<PinnedGlob, GitPinError> {
  const ref = args.source.gitRef;
  if (ref === undefined) {
    throw new Error(
      'pinGlobSource: source has no gitRef declared (caller should not call us)',
    );
  }
  const discovery = discoverRepoRoot(
    {
      glob: args.source.glob,
      configDir: args.configDir,
      gitRoot: args.source.gitRoot,
    },
    deps.repoDiscovery,
  );
  if (discovery.isErr()) {
    return errAsync(pinErrorForDiscovery(discovery.error));
  }
  const repoRoot = discovery.value;
  return resolveGitRefToSha(deps.port, repoRoot, ref)
    .mapErr<GitPinError>((e) => ({
      kind: 'git-pin',
      reason: 'unresolvable-ref',
      message: `gitRef "${e.ref}" did not resolve to a commit in ${e.repoRoot} — check spelling, that the ref exists locally (fetch first if it lives on a remote), and that it is a full SHA, short SHA, or annotated tag (slice 1 does not yet support branches or lightweight tags)`,
    }))
    .map((sha) => ({
      repoRoot,
      resolvedSha: sha,
      ref,
      contentReader: async (absolutePath: string): Promise<Buffer | null> => {
        const rel = relative(repoRoot, absolutePath);
        if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`)) {
          throw new Error(
            `pinGlobSource: matched path ${absolutePath} is outside repoRoot ${repoRoot}; refusing to fetch from git tree`,
          );
        }
        // git ls-tree / git show uses forward slashes regardless of platform.
        const gitPath = rel.split(sep).join('/');
        const buf = await deps.port.readFileAtSha(repoRoot, sha, gitPath);
        if (buf === null) {
          throw new PinnedFileMissingError(absolutePath, gitPath, sha, ref);
        }
        return buf;
      },
    }));
}

export class PinnedFileMissingError extends Error {
  readonly kind = 'pinned-file-missing' as const;
  constructor(
    readonly absolutePath: string,
    readonly repoRelPath: string,
    readonly sha: string,
    readonly ref: string,
  ) {
    super(
      `pinned source: file ${repoRelPath} is absent from the git tree at ${ref} (resolved to ${sha.slice(0, 12)})`,
    );
    this.name = 'PinnedFileMissingError';
  }
}

function pinErrorForDiscovery(err: DiscoverRepoError): GitPinError {
  if (err.kind === 'no-repo-found') {
    return {
      kind: 'git-pin',
      reason: 'no-repo-found',
      message: `gitRef requires a git repository — none found by walking up from ${err.from}. Either move the glob inside a repo or set gitRoot:`,
    };
  }
  return {
    kind: 'git-pin',
    reason: 'gitroot-not-a-repo',
    message: `gitRoot ${err.gitRootResolved} is not a git repository (no .git directory found)`,
  };
}
