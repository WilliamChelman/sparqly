import { describe, expect, it, vi } from 'vitest';
import type { ParsedGlobSource } from './source-spec';
import { walkGlobPaths } from './walk-glob-paths';

describe('walkGlobPaths', () => {
  it('returns matched absolute paths for a plain glob without reading file contents', async () => {
    const walkGlob = vi.fn(async (pattern: string) => {
      expect(pattern).toBe('/abs/data/*.ttl');
      return ['/abs/data/a.ttl', '/abs/data/b.ttl'];
    });
    const source: ParsedGlobSource = {
      kind: 'glob',
      id: 'docs',
      glob: '/abs/data/*.ttl',
    };

    const paths = await walkGlobPaths(source, { walkGlob });

    expect(paths).toEqual(['/abs/data/a.ttl', '/abs/data/b.ttl']);
    expect(walkGlob).toHaveBeenCalledTimes(1);
  });

  it('walks split globs via the same plain-glob path (parsing/transforms are not invoked here)', async () => {
    const walkGlob = vi.fn(async () => [
      '/abs/data/a.ttl',
      '/abs/data/sub/b.ttl',
    ]);
    const source: ParsedGlobSource = {
      kind: 'glob',
      id: 'docs',
      glob: '/abs/data/**/*.ttl',
      splitByFile: true,
    };

    const paths = await walkGlobPaths(source, { walkGlob });

    expect(paths).toEqual(['/abs/data/a.ttl', '/abs/data/sub/b.ttl']);
  });

  it('routes pinned globs through walkGitGlob instead of walkGlob', async () => {
    const walkGlob = vi.fn(async () => {
      throw new Error('walkGlob must not be called for pinned globs');
    });
    const walkGitGlob = vi.fn(async () => ({
      files: ['/abs/repo/data/a.ttl', '/abs/repo/data/b.ttl'],
      repoRoot: '/abs/repo',
      ref: 'main',
      resolvedSha: '0'.repeat(40),
    }));
    const source: ParsedGlobSource = {
      kind: 'glob',
      id: 'docs',
      glob: '/abs/repo/data/*.ttl',
      gitRef: 'main',
    };

    const paths = await walkGlobPaths(source, { walkGlob, walkGitGlob });

    expect(paths).toEqual(['/abs/repo/data/a.ttl', '/abs/repo/data/b.ttl']);
    expect(walkGitGlob).toHaveBeenCalledTimes(1);
    expect(walkGlob).not.toHaveBeenCalled();
  });

  it('throws when a pinned glob is walked without a walkGitGlob dep', async () => {
    const source: ParsedGlobSource = {
      kind: 'glob',
      id: 'docs',
      glob: '/abs/repo/data/*.ttl',
      gitRef: 'main',
    };
    await expect(
      walkGlobPaths(source, { walkGlob: async () => [] }),
    ).rejects.toThrow(/walkGitGlob/);
  });
});
