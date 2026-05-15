import { describe, expect, it, vi } from 'vitest';
import type { GitPort } from './git-port';
import { pinGlobSource } from './pin-glob-source';
import type { ParsedGlobSource } from '../source-spec';
import { recordingLogger } from '../../test/recording-logger';

const SHA = '0123456789abcdef0123456789abcdef01234567';

function source(overrides: Partial<ParsedGlobSource> = {}): ParsedGlobSource {
  return {
    kind: 'glob',
    glob: '/work/repo/vendor/foaf.ttl',
    id: 'foaf',
    gitRef: 'v1.2.0',
    ...overrides,
  };
}

function stubPort(
  overrides: Partial<GitPort> = {},
): GitPort {
  return {
    resolveRefToSha: vi.fn(async () => SHA),
    readFileAtSha: vi.fn(async () => Buffer.from('old-content\n', 'utf8')),
    getRefObjectType: vi.fn(async () => 'tag'),
    ...overrides,
  };
}

const STUB_FS_REPO_AT = (...repos: ReadonlyArray<string>) => ({
  hasGitDir: (dir: string): boolean => repos.includes(dir),
});

describe('pinGlobSource — happy path', () => {
  it('discovers the repo, resolves the ref to a SHA, and returns a content reader sourced from the git tree', async () => {
    const port = stubPort();
    const result = await pinGlobSource(
      { source: source(), configDir: '/work/repo' },
      { port, repoDiscovery: STUB_FS_REPO_AT('/work/repo') },
    );

    expect(result.isOk()).toBe(true);
    const pinned = result._unsafeUnwrap();
    expect(pinned.repoRoot).toBe('/work/repo');
    expect(pinned.resolvedSha).toBe(SHA);
    expect(pinned.ref).toBe('v1.2.0');
    expect(pinned.kind).toBe('pinned');

    const buf = await pinned.contentReader('/work/repo/vendor/foaf.ttl');
    expect(buf?.toString('utf8')).toBe('old-content\n');
    expect(port.readFileAtSha).toHaveBeenCalledWith(
      '/work/repo',
      SHA,
      'vendor/foaf.ttl',
    );
  });

  it('honours gitRoot override (relative to configDir)', async () => {
    const port = stubPort();
    const result = await pinGlobSource(
      {
        source: source({ gitRoot: '../vendor-onts' }),
        configDir: '/work/repo',
      },
      { port, repoDiscovery: STUB_FS_REPO_AT('/work/vendor-onts') },
    );

    expect(result._unsafeUnwrap().repoRoot).toBe('/work/vendor-onts');
  });
});

describe('pinGlobSource — floating-ref log (ADR-0029, #273)', () => {
  it('logs `<ref> → <sha>` exactly once when the resolved kind is floating', async () => {
    const { logger, entries } = recordingLogger();
    const port = stubPort({ getRefObjectType: vi.fn(async () => 'commit') });
    await pinGlobSource(
      { source: source({ gitRef: 'main' }), configDir: '/work/repo' },
      {
        port,
        repoDiscovery: STUB_FS_REPO_AT('/work/repo'),
        logger,
      },
    );
    const matched = entries.filter((e) =>
      e.msg.includes(`main → ${SHA}`),
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].level).toBe('info');
  });

  it('does NOT log when the resolved kind is pinned (full SHA)', async () => {
    const { logger, entries } = recordingLogger();
    await pinGlobSource(
      { source: source({ gitRef: SHA }), configDir: '/work/repo' },
      {
        port: stubPort(),
        repoDiscovery: STUB_FS_REPO_AT('/work/repo'),
        logger,
      },
    );
    const matched = entries.filter((e) => /→/.test(e.msg));
    expect(matched).toHaveLength(0);
  });

  it('does NOT log when the resolved kind is pinned (annotated tag)', async () => {
    const { logger, entries } = recordingLogger();
    await pinGlobSource(
      { source: source({ gitRef: 'v1.2.0' }), configDir: '/work/repo' },
      {
        port: stubPort({ getRefObjectType: vi.fn(async () => 'tag') }),
        repoDiscovery: STUB_FS_REPO_AT('/work/repo'),
        logger,
      },
    );
    const matched = entries.filter((e) => /→/.test(e.msg));
    expect(matched).toHaveLength(0);
  });
});

describe('pinGlobSource — errors', () => {
  it('returns no-repo-found when no .git is reachable and gitRoot is not set', async () => {
    const result = await pinGlobSource(
      { source: source(), configDir: '/work/lonely' },
      { port: stubPort(), repoDiscovery: STUB_FS_REPO_AT() },
    );

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.kind).toBe('git-pin');
    expect(error.reason).toBe('no-repo-found');
    expect(error.message).toMatch(
      /gitRef requires a git repository — none found by walking up from .*\. Either move the glob inside a repo or set gitRoot:/,
    );
  });

  it('returns gitroot-not-a-repo when gitRoot points at a non-repo path', async () => {
    const result = await pinGlobSource(
      {
        source: source({ gitRoot: '../vendor-onts' }),
        configDir: '/work/repo',
      },
      { port: stubPort(), repoDiscovery: STUB_FS_REPO_AT() },
    );

    const error = result._unsafeUnwrapErr();
    expect(error.reason).toBe('gitroot-not-a-repo');
    expect(error.message).toMatch(
      /gitRoot .*vendor-onts is not a git repository/,
    );
  });

  it('returns unresolvable-ref when the port cannot resolve the ref', async () => {
    const result = await pinGlobSource(
      { source: source({ gitRef: 'v999' }), configDir: '/work/repo' },
      {
        port: stubPort({ resolveRefToSha: async () => null }),
        repoDiscovery: STUB_FS_REPO_AT('/work/repo'),
      },
    );

    const error = result._unsafeUnwrapErr();
    expect(error.reason).toBe('unresolvable-ref');
    expect(error.message).toMatch(/gitRef "v999".*did not resolve/);
  });
});
