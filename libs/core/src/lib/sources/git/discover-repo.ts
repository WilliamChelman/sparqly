import { dirname, isAbsolute, resolve } from 'node:path';
import { err, ok, type Result } from 'neverthrow';

export interface RepoDiscoveryDeps {
  /** Returns true if `<dir>/.git` exists as a directory. */
  hasGitDir(dir: string): boolean;
}

export interface DiscoverRepoArgs {
  /** Glob pattern as declared (absolute or relative to configDir). */
  glob: string;
  /** Absolute path to the directory containing the project config. */
  configDir: string;
  /** Optional explicit override (relative to configDir or absolute). */
  gitRoot?: string;
}

export type DiscoverRepoError =
  | { kind: 'no-repo-found'; from: string }
  | { kind: 'gitroot-not-a-repo'; gitRootResolved: string };

const WILDCARD_SEGMENT = /[*?[\]{}]/;

/**
 * Strips wildcard segments from the tail of a glob, returning the directory
 * portion that precedes any glob metacharacter. `data/**\/*.ttl` → `data`;
 * `vendor/foaf.ttl` → `vendor` (the file's parent dir).
 */
function globBase(glob: string): string {
  const parts = glob.split('/');
  const firstWild = parts.findIndex((p) => WILDCARD_SEGMENT.test(p));
  const dirParts = firstWild === -1 ? parts.slice(0, -1) : parts.slice(0, firstWild);
  if (dirParts.length === 0) return '.';
  const joined = dirParts.join('/');
  return joined === '' ? '/' : joined;
}

export function discoverRepoRoot(
  args: DiscoverRepoArgs,
  deps: RepoDiscoveryDeps,
): Result<string, DiscoverRepoError> {
  if (args.gitRoot !== undefined) {
    const resolved = isAbsolute(args.gitRoot)
      ? args.gitRoot
      : resolve(args.configDir, args.gitRoot);
    if (!deps.hasGitDir(resolved)) {
      return err({ kind: 'gitroot-not-a-repo', gitRootResolved: resolved });
    }
    return ok(resolved);
  }

  const baseRel = globBase(args.glob);
  const base = isAbsolute(baseRel) ? baseRel : resolve(args.configDir, baseRel);

  let cur = base;
  // Walk up until either a .git is found or we hit the filesystem root.
  // dirname('/') === '/' on posix, so the fixed-point check halts cleanly.
  while (true) {
    if (deps.hasGitDir(cur)) return ok(cur);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return err({ kind: 'no-repo-found', from: base });
}
