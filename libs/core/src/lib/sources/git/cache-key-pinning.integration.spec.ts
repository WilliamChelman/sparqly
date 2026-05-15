import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitCliPort } from './git-cli-port';
import { defaultRepoDiscovery } from './pin-glob-source';
import { normalizeRegistryPinsResult } from './normalize-registry-pins';
import type { ParsedSource, ParsedViewSource } from '../source-spec';
import { viewCacheKey } from '../../views/view-cache';

const execFileAsync = promisify(execFile);

async function git(repo: string, args: ReadonlyArray<string>): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
  return stdout.trim();
}

const TTL = '@prefix ex: <http://example.org/> .\nex:a ex:b ex:c .\n';

describe('cache-key pinning (ADR-0029)', () => {
  let repo: string;
  let sha: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-cache-pin-'));
    await writeFile(join(repo, 'foaf.ttl'), TTL);
    await git(repo, ['init', '-q', '-b', 'main']);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    await git(repo, ['tag', '-a', 'v1.2.0', '-m', 'release']);
    sha = await git(repo, ['rev-parse', 'HEAD']);
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  const view: ParsedViewSource = {
    kind: 'view',
    id: 'cached',
    from: 'foaf',
    query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
    cache: { strategy: 'ttl', ttlMs: 60_000 },
  };

  function registryAt(ref: string): ReadonlyArray<ParsedSource> {
    return [
      { kind: 'glob', id: 'foaf', glob: join(repo, 'foaf.ttl'), gitRef: ref },
      view,
    ];
  }

  it('produces the same view cache key whether the glob is pinned via annotated tag or full SHA', async () => {
    const deps = {
      configDir: repo,
      port: new GitCliPort(),
      repoDiscovery: defaultRepoDiscovery,
    };

    const viaTag = await normalizeRegistryPinsResult(registryAt('v1.2.0'), deps);
    const viaSha = await normalizeRegistryPinsResult(registryAt(sha), deps);
    expect(viaTag.isOk()).toBe(true);
    expect(viaSha.isOk()).toBe(true);

    const tagRegistry = viaTag._unsafeUnwrap();
    const shaRegistry = viaSha._unsafeUnwrap();

    const keyViaTag = viewCacheKey({
      view,
      upstream: [tagRegistry[0]],
      cacheDir: '/x',
      registry: tagRegistry,
    });
    const keyViaSha = viewCacheKey({
      view,
      upstream: [shaRegistry[0]],
      cacheDir: '/x',
      registry: shaRegistry,
    });
    expect(keyViaTag).toEqual(keyViaSha);
  });

  it('produces different keys when the resolved SHA differs (sanity check)', async () => {
    const deps = {
      configDir: repo,
      port: new GitCliPort(),
      repoDiscovery: defaultRepoDiscovery,
    };
    const v1 = await normalizeRegistryPinsResult(registryAt('v1.2.0'), deps);
    expect(v1.isOk()).toBe(true);
    const v1Registry = v1._unsafeUnwrap();
    const keyAtV1 = viewCacheKey({
      view,
      upstream: [v1Registry[0]],
      cacheDir: '/x',
      registry: v1Registry,
    });

    // Manually fabricate a registry with a different resolvedSha
    const fakeRegistry: ReadonlyArray<ParsedSource> = [
      {
        kind: 'glob',
        id: 'foaf',
        glob: join(repo, 'foaf.ttl'),
        gitRef: 'v1.2.0',
        resolvedSha: 'fedcba9876543210fedcba9876543210fedcba98',
      },
      view,
    ];
    const keyDifferent = viewCacheKey({
      view,
      upstream: [fakeRegistry[0]],
      cacheDir: '/x',
      registry: fakeRegistry,
    });
    expect(keyAtV1).not.toEqual(keyDifferent);
  });
});
