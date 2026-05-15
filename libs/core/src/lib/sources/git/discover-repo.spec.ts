import { describe, expect, it } from 'vitest';
import { discoverRepoRoot, type RepoDiscoveryDeps } from './discover-repo';

function makeFs(gitDirs: ReadonlyArray<string>): RepoDiscoveryDeps {
  const set = new Set(gitDirs);
  return { hasGitDir: (dir: string): boolean => set.has(dir) };
}

describe('discoverRepoRoot — implicit walk-up from glob base', () => {
  it('finds the repo at the glob base directory itself', () => {
    const deps = makeFs(['/work/repo']);
    const result = discoverRepoRoot(
      { glob: '/work/repo/vendor/foaf.ttl', configDir: '/work/repo' },
      deps,
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('/work/repo');
  });

  it('walks up multiple directories until a .git is found', () => {
    const deps = makeFs(['/work/repo']);
    const result = discoverRepoRoot(
      {
        glob: '/work/repo/nested/deep/data/*.ttl',
        configDir: '/work/repo',
      },
      deps,
    );
    expect(result._unsafeUnwrap()).toBe('/work/repo');
  });

  it('uses the directory portion before the first wildcard segment as the search base', () => {
    const deps = makeFs(['/work/repo']);
    const result = discoverRepoRoot(
      { glob: '/work/repo/ontologies/**/*.ttl', configDir: '/work/repo' },
      deps,
    );
    expect(result._unsafeUnwrap()).toBe('/work/repo');
  });

  it('returns a no-repo-found error when no .git is reachable by walking up', () => {
    const deps = makeFs([]);
    const result = discoverRepoRoot(
      { glob: '/work/lonely/vendor/foaf.ttl', configDir: '/work/lonely' },
      deps,
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({
      kind: 'no-repo-found',
      from: '/work/lonely/vendor',
    });
  });

  it('stops at the root filesystem boundary (does not loop)', () => {
    const deps = makeFs([]);
    const result = discoverRepoRoot(
      { glob: '/foo.ttl', configDir: '/' },
      deps,
    );
    expect(result._unsafeUnwrapErr()).toEqual({
      kind: 'no-repo-found',
      from: '/',
    });
  });
});

describe('discoverRepoRoot — gitRoot override', () => {
  it('resolves gitRoot relative to configDir when it points at a real repo', () => {
    const deps = makeFs(['/work/vendor-onts']);
    const result = discoverRepoRoot(
      {
        glob: '/work/repo/vendor/foaf.ttl',
        configDir: '/work/repo',
        gitRoot: '../vendor-onts',
      },
      deps,
    );
    expect(result._unsafeUnwrap()).toBe('/work/vendor-onts');
  });

  it('accepts an absolute gitRoot', () => {
    const deps = makeFs(['/elsewhere/repo']);
    const result = discoverRepoRoot(
      {
        glob: '/work/repo/vendor/foaf.ttl',
        configDir: '/work/repo',
        gitRoot: '/elsewhere/repo',
      },
      deps,
    );
    expect(result._unsafeUnwrap()).toBe('/elsewhere/repo');
  });

  it('returns gitroot-not-a-repo when the override does not contain a .git directory', () => {
    const deps = makeFs([]);
    const result = discoverRepoRoot(
      {
        glob: '/work/repo/vendor/foaf.ttl',
        configDir: '/work/repo',
        gitRoot: '../vendor-onts',
      },
      deps,
    );
    expect(result._unsafeUnwrapErr()).toEqual({
      kind: 'gitroot-not-a-repo',
      gitRootResolved: '/work/vendor-onts',
    });
  });

  it('does not walk up from gitRoot — the override is a single, explicit path', () => {
    // Even if the parent of gitRoot is a repo, an explicit gitRoot that
    // doesn't itself carry .git is an error (the user said "look here").
    const deps = makeFs(['/work']);
    const result = discoverRepoRoot(
      {
        glob: '/work/repo/vendor/foaf.ttl',
        configDir: '/work/repo',
        gitRoot: '../vendor-onts',
      },
      deps,
    );
    expect(result._unsafeUnwrapErr()).toEqual({
      kind: 'gitroot-not-a-repo',
      gitRootResolved: '/work/vendor-onts',
    });
  });
});
