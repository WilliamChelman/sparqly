import { describe, expect, it } from 'vitest';
import { translatePathspec } from './pathspec-translation';

describe('translatePathspec — glob source', () => {
  it('rewrites a configDir-relative glob as :(glob,top)<repo-relative-pattern>', () => {
    const out = translatePathspec({
      kind: 'glob',
      pattern: 'docs/**/*.ttl',
      configDir: '/repo',
      repoRoot: '/repo',
    });
    expect(out).toBe(':(glob,top)docs/**/*.ttl');
  });

  it('relativizes a configDir-relative pattern across nested configDir', () => {
    const out = translatePathspec({
      kind: 'glob',
      pattern: '*.ttl',
      configDir: '/repo/apps/web',
      repoRoot: '/repo',
    });
    expect(out).toBe(':(glob,top)apps/web/*.ttl');
  });

  it('passes an absolute glob pattern through as repo-relative', () => {
    const out = translatePathspec({
      kind: 'glob',
      pattern: '/repo/data/*.ttl',
      configDir: '/repo',
      repoRoot: '/repo',
    });
    expect(out).toBe(':(glob,top)data/*.ttl');
  });
});

describe('translatePathspec — file source', () => {
  it('relativizes an absolute file path against the repo root', () => {
    const out = translatePathspec({
      kind: 'file',
      path: '/repo/docs/people/alice.ttl',
      repoRoot: '/repo',
    });
    expect(out).toBe('docs/people/alice.ttl');
  });
});
