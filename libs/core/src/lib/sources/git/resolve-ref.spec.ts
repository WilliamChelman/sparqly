import { describe, expect, it, vi } from 'vitest';
import type { GitPort } from './git-port';
import { resolveGitRefToSha } from './resolve-ref';

function stubPort(
  resolveRefToSha: GitPort['resolveRefToSha'],
): GitPort {
  return {
    resolveRefToSha,
    readFileAtSha: vi.fn(),
  };
}

const SHA = '0123456789abcdef0123456789abcdef01234567';
const REPO = '/work/repo';

describe('resolveGitRefToSha', () => {
  it('returns the resolved SHA when the port resolves the ref', async () => {
    const port = stubPort(async () => SHA);
    const result = await resolveGitRefToSha(port, REPO, 'v1.2.0');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(SHA);
  });

  it('passes repoRoot and ref through to the port verbatim', async () => {
    const spy = vi.fn(async () => SHA);
    await resolveGitRefToSha(stubPort(spy), REPO, 'v1.2.0');
    expect(spy).toHaveBeenCalledWith(REPO, 'v1.2.0');
  });

  it('returns an unresolvable-ref error when the port returns null', async () => {
    const port = stubPort(async () => null);
    const result = await resolveGitRefToSha(port, REPO, 'v999');
    expect(result._unsafeUnwrapErr()).toEqual({
      kind: 'unresolvable-ref',
      ref: 'v999',
      repoRoot: REPO,
    });
  });
});
