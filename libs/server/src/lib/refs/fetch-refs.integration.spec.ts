import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchRefs } from './fetch-refs';

const execFileAsync = promisify(execFile);

async function git(
  repo: string,
  args: ReadonlyArray<string>,
): Promise<string> {
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

describe('fetchRefs — success against a file-protocol remote', () => {
  let bare: string;
  let local: string;
  let updatedSha: string;

  beforeAll(async () => {
    bare = await mkdtemp(join(tmpdir(), 'sparqly-fetch-refs-bare-'));
    await git(bare, ['init', '-q', '--bare', '-b', 'main']);

    const seed = await mkdtemp(join(tmpdir(), 'sparqly-fetch-refs-seed-'));
    await git(seed, ['init', '-q', '-b', 'main']);
    await writeFile(join(seed, 'a.txt'), 'one\n');
    await git(seed, ['add', '.']);
    await git(seed, ['commit', '-q', '-m', 'first']);
    await git(seed, ['remote', 'add', 'origin', bare]);
    await git(seed, ['push', '-q', 'origin', 'main']);

    local = await mkdtemp(join(tmpdir(), 'sparqly-fetch-refs-local-'));
    await git(local, ['init', '-q', '-b', 'main']);
    await git(local, ['remote', 'add', 'origin', bare]);

    // Advance remote so the fetch must move origin/main forward.
    await writeFile(join(seed, 'a.txt'), 'two\n');
    await git(seed, ['add', '.']);
    await git(seed, ['commit', '-q', '-m', 'second']);
    await git(seed, ['push', '-q', 'origin', 'main']);
    updatedSha = await git(seed, ['rev-parse', 'HEAD']);

    await rm(seed, { recursive: true, force: true });
  }, 60_000);

  afterAll(async () => {
    if (local) await rm(local, { recursive: true, force: true });
    if (bare) await rm(bare, { recursive: true, force: true });
  });

  it('runs git fetch and returns the post-fetch RefsResponse', async () => {
    const result = await fetchRefs(local);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const refs = result.value;
    const remote = refs.remoteBranches.find((r) => r.ref === 'origin/main');
    expect(remote).toEqual({
      ref: 'origin/main',
      sha: updatedSha,
      kind: 'remote-branch',
      remote: 'origin',
    });
  });
});

describe('fetchRefs — repo with no remotes', () => {
  let repo: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-fetch-refs-no-remote-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    await writeFile(join(repo, 'a.txt'), 'one\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('returns Result.err({ kind: "no-remote" })', async () => {
    const result = await fetchRefs(repo);
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error).toEqual({ kind: 'no-remote' });
  });
});

describe('fetchRefs — non-existent remote', () => {
  let repo: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-fetch-refs-bad-remote-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    await writeFile(join(repo, 'a.txt'), 'one\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    await git(repo, [
      'remote',
      'add',
      'origin',
      join(tmpdir(), 'sparqly-fetch-refs-does-not-exist-' + Date.now()),
    ]);
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('returns Result.err({ kind: "network" })', async () => {
    const result = await fetchRefs(repo);
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error).toEqual({ kind: 'network' });
  });
});
