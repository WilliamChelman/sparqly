import { describe, expect, it, vi } from 'vitest';
import type { GitPort } from './git-port';
import { resolveGitRef } from './resolve-ref';

function stubPort(overrides: Partial<GitPort> = {}): GitPort {
  return {
    resolveRefToSha: vi.fn(async () => SHA),
    readFileAtSha: vi.fn(),
    getRefObjectType: vi.fn(async () => 'commit'),
    ...overrides,
  };
}

const SHA = '0123456789abcdef0123456789abcdef01234567';
const REPO = '/work/repo';

describe('resolveGitRef — classification (ADR-0029, issue #273)', () => {
  it('classifies a 40-hex commit SHA as pinned and skips the object-type lookup', async () => {
    const getRefObjectType = vi.fn(async () => 'commit' as const);
    const port = stubPort({ getRefObjectType });
    const result = await resolveGitRef(port, REPO, SHA);
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'pinned',
      sha: SHA,
      refString: SHA,
    });
    expect(getRefObjectType).not.toHaveBeenCalled();
  });

  it('classifies an annotated-tag ref (object type "tag") as pinned', async () => {
    const port = stubPort({
      getRefObjectType: vi.fn(async () => 'tag'),
    });
    const result = await resolveGitRef(port, REPO, 'v1.2.0');
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'pinned',
      sha: SHA,
      refString: 'v1.2.0',
    });
  });

  it('classifies a branch ref (object type "commit", non-SHA name) as floating', async () => {
    const port = stubPort({
      getRefObjectType: vi.fn(async () => 'commit'),
    });
    const result = await resolveGitRef(port, REPO, 'main');
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'floating',
      sha: SHA,
      refString: 'main',
    });
  });

  it('classifies HEAD as floating', async () => {
    const port = stubPort({
      getRefObjectType: vi.fn(async () => 'commit'),
    });
    const result = await resolveGitRef(port, REPO, 'HEAD');
    expect(result._unsafeUnwrap().kind).toBe('floating');
  });

  it('classifies HEAD~n as floating', async () => {
    const port = stubPort({
      getRefObjectType: vi.fn(async () => 'commit'),
    });
    const result = await resolveGitRef(port, REPO, 'HEAD~2');
    expect(result._unsafeUnwrap().kind).toBe('floating');
  });

  it('classifies a lightweight-tag ref (object type "commit") as floating', async () => {
    // A lightweight tag points directly at a commit, so `cat-file -t <tagname>`
    // returns "commit" — distinguishing it from an annotated tag (returns "tag").
    const port = stubPort({
      getRefObjectType: vi.fn(async () => 'commit'),
    });
    const result = await resolveGitRef(port, REPO, 'lightweight-tag');
    expect(result._unsafeUnwrap().kind).toBe('floating');
  });

  it('preserves the user-typed ref string verbatim on the result', async () => {
    const port = stubPort({
      getRefObjectType: vi.fn(async () => 'commit'),
    });
    const result = await resolveGitRef(port, REPO, 'origin/main');
    expect(result._unsafeUnwrap().refString).toBe('origin/main');
  });

  it('returns an unresolvable-ref error when the port returns null', async () => {
    const port = stubPort({ resolveRefToSha: async () => null });
    const result = await resolveGitRef(port, REPO, 'v999');
    expect(result._unsafeUnwrapErr()).toEqual({
      kind: 'unresolvable-ref',
      ref: 'v999',
      repoRoot: REPO,
    });
  });

  it('does not call getRefObjectType when the ref fails to resolve', async () => {
    const getRefObjectType = vi.fn(async () => 'commit' as const);
    const port = stubPort({
      resolveRefToSha: async () => null,
      getRefObjectType,
    });
    await resolveGitRef(port, REPO, 'v999');
    expect(getRefObjectType).not.toHaveBeenCalled();
  });
});
