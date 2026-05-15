import { describe, expect, it } from 'vitest';
import type { GitPort } from './git-port';
import type { RepoDiscoveryDeps } from './discover-repo';
import { walkGitTree } from './walk-git-tree';

function stubPort(files: ReadonlyArray<string>): GitPort {
  return {
    resolveRefToSha: async () => null,
    getRefObjectType: async () => null,
    readFileAtSha: async () => null,
    listFilesAtSha: async () => files,
  };
}

const REPO_AT = (...repos: ReadonlyArray<string>): RepoDiscoveryDeps => ({
  hasGitDir: (dir: string): boolean => repos.includes(dir),
});

describe('walkGitTree — happy path', () => {
  it('returns absolute paths for files matching the relative glob at the given SHA', async () => {
    const port = stubPort([
      'data/foo.ttl',
      'data/sub/bar.ttl',
      'other.txt',
      'data/notes.md',
    ]);
    const result = await walkGitTree(
      {
        glob: '/abs/repo/data/**/*.ttl',
        repoRoot: '/abs/repo',
        sha: 'a'.repeat(40),
      },
      { gitPort: port, repoDiscovery: REPO_AT('/abs/repo') },
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value).toEqual([
      '/abs/repo/data/foo.ttl',
      '/abs/repo/data/sub/bar.ttl',
    ]);
  });
});

describe('walkGitTree — single-repo invariant', () => {
  it('errors with both repo paths when a matched path falls under a nested .git inside repoRoot', async () => {
    const port = stubPort(['nested/inner.ttl', 'top.ttl']);
    const result = await walkGitTree(
      {
        glob: '/abs/repo/**/*.ttl',
        repoRoot: '/abs/repo',
        sha: 'a'.repeat(40),
      },
      {
        gitPort: port,
        repoDiscovery: REPO_AT('/abs/repo', '/abs/repo/nested'),
      },
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('spans-multiple-repos');
    expect(result.error.message).toContain('/abs/repo');
    expect(result.error.message).toContain('/abs/repo/nested');
  });

  it('errors with `glob-outside-repo` when the glob base sits outside repoRoot', async () => {
    const port = stubPort([]);
    const result = await walkGitTree(
      {
        glob: '/abs/elsewhere/*.ttl',
        repoRoot: '/abs/repo',
        sha: 'a'.repeat(40),
      },
      { gitPort: port, repoDiscovery: REPO_AT('/abs/repo') },
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('glob-outside-repo');
  });
});
