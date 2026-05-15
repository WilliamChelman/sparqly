import { describe, expect, it, vi } from 'vitest';
import { normalizeRegistryPinsResult } from './normalize-registry-pins';
import type { GitPort } from './git-port';
import type { ParsedSource } from '../source-spec';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const SHA_B = 'fedcba9876543210fedcba9876543210fedcba98';

function stubPort(overrides: Partial<GitPort> = {}): GitPort {
  return {
    resolveRefToSha: vi.fn(async () => SHA),
    readFileAtSha: vi.fn(async () => Buffer.from('', 'utf8')),
    getRefObjectType: vi.fn(async () => 'tag'),
    listFilesAtSha: vi.fn(async () => []),
    ...overrides,
  };
}

const STUB_FS_REPO_AT = (...repos: ReadonlyArray<string>) => ({
  hasGitDir: (dir: string): boolean => repos.includes(dir),
});

describe('normalizeRegistryPinsResult', () => {
  it('returns the registry unchanged when no glob declares gitRef', async () => {
    const registry: ReadonlyArray<ParsedSource> = [
      { kind: 'glob', id: 'a', glob: 'data/*.ttl' },
      {
        kind: 'view',
        id: 'v',
        from: 'a',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ];
    const result = await normalizeRegistryPinsResult(registry, {
      configDir: '/work/repo',
      port: stubPort(),
      repoDiscovery: STUB_FS_REPO_AT('/work/repo'),
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(registry);
  });

  it('stamps resolvedSha on each gitRef-bearing glob', async () => {
    const registry: ReadonlyArray<ParsedSource> = [
      { kind: 'glob', id: 'pinned', glob: 'data/*.ttl', gitRef: 'v1.2.0' },
      { kind: 'glob', id: 'unpinned', glob: 'other/*.ttl' },
    ];
    const result = await normalizeRegistryPinsResult(registry, {
      configDir: '/work/repo',
      port: stubPort(),
      repoDiscovery: STUB_FS_REPO_AT('/work/repo'),
    });
    expect(result.isOk()).toBe(true);
    const out = result._unsafeUnwrap();
    expect(out[0]).toMatchObject({ id: 'pinned', gitRef: 'v1.2.0', resolvedSha: SHA });
    expect(out[1]).toEqual(registry[1]);
  });

  it('resolves distinct refs across multiple globs independently', async () => {
    const port = stubPort({
      resolveRefToSha: vi.fn(async (_root, ref) =>
        ref === 'v1.2.0' ? SHA : SHA_B,
      ),
    });
    const registry: ReadonlyArray<ParsedSource> = [
      { kind: 'glob', id: 'a', glob: 'a/*.ttl', gitRef: 'v1.2.0' },
      { kind: 'glob', id: 'b', glob: 'b/*.ttl', gitRef: 'main' },
    ];
    const result = await normalizeRegistryPinsResult(registry, {
      configDir: '/work/repo',
      port,
      repoDiscovery: STUB_FS_REPO_AT('/work/repo'),
    });
    expect(result.isOk()).toBe(true);
    const out = result._unsafeUnwrap();
    expect((out[0] as { resolvedSha?: string }).resolvedSha).toBe(SHA);
    expect((out[1] as { resolvedSha?: string }).resolvedSha).toBe(SHA_B);
  });

  it('surfaces a git-pin error when a ref does not resolve', async () => {
    const registry: ReadonlyArray<ParsedSource> = [
      { kind: 'glob', id: 'pinned', glob: 'data/*.ttl', gitRef: 'v999' },
    ];
    const result = await normalizeRegistryPinsResult(registry, {
      configDir: '/work/repo',
      port: stubPort({ resolveRefToSha: async () => null }),
      repoDiscovery: STUB_FS_REPO_AT('/work/repo'),
    });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('git-pin');
    if (result.error.kind !== 'git-pin') throw new Error('unreachable');
    expect(result.error.reason).toBe('unresolvable-ref');
  });

  it('does not re-resolve a glob that already carries resolvedSha', async () => {
    const port = stubPort();
    const registry: ReadonlyArray<ParsedSource> = [
      {
        kind: 'glob',
        id: 'already',
        glob: 'data/*.ttl',
        gitRef: 'v1.2.0',
        resolvedSha: SHA,
      },
    ];
    const result = await normalizeRegistryPinsResult(registry, {
      configDir: '/work/repo',
      port,
      repoDiscovery: STUB_FS_REPO_AT('/work/repo'),
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()[0]).toBe(registry[0]);
    expect(port.resolveRefToSha).not.toHaveBeenCalled();
  });
});
