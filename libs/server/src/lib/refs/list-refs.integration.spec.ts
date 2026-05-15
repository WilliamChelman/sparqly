import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listRefs } from './list-refs';

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

describe('listRefs — single-branch repo', () => {
  let repo: string;
  let commitSha: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-list-refs-tracer-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    await writeFile(join(repo, 'a.txt'), 'one\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    commitSha = await git(repo, ['rev-parse', 'HEAD']);
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('returns head and the single branch; tags and remoteBranches are empty', async () => {
    const refs = await listRefs(repo);
    expect(refs.head).toEqual({ ref: 'HEAD', sha: commitSha, kind: 'head' });
    expect(refs.branches).toEqual([
      { ref: 'main', sha: commitSha, kind: 'branch' },
    ]);
    expect(refs.remoteBranches).toEqual([]);
    expect(refs.tags).toEqual([]);
  });
});

describe('listRefs — detached HEAD', () => {
  let repo: string;
  let firstSha: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-list-refs-detached-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    await writeFile(join(repo, 'a.txt'), 'one\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    firstSha = await git(repo, ['rev-parse', 'HEAD']);
    await writeFile(join(repo, 'a.txt'), 'two\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'second']);
    await git(repo, ['checkout', '-q', '--detach', firstSha]);
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('returns head pointing at the detached commit (kind: head)', async () => {
    const refs = await listRefs(repo);
    expect(refs.head).toEqual({ ref: 'HEAD', sha: firstSha, kind: 'head' });
  });
});

describe('listRefs — remote-tracking branches', () => {
  let repo: string;
  let commitSha: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-list-refs-remotes-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    await writeFile(join(repo, 'a.txt'), 'one\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    commitSha = await git(repo, ['rev-parse', 'HEAD']);
    await git(repo, ['update-ref', 'refs/remotes/origin/main', commitSha]);
    await git(repo, [
      'update-ref',
      'refs/remotes/origin/feat/foo',
      commitSha,
    ]);
    await git(repo, [
      'symbolic-ref',
      'refs/remotes/origin/HEAD',
      'refs/remotes/origin/main',
    ]);
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('lists remote branches under remoteBranches with the `remote` field', async () => {
    const refs = await listRefs(repo);
    const byRef = new Map(refs.remoteBranches.map((r) => [r.ref, r]));
    expect(byRef.get('origin/main')).toEqual({
      ref: 'origin/main',
      sha: commitSha,
      kind: 'remote-branch',
      remote: 'origin',
    });
    expect(byRef.get('origin/feat/foo')).toEqual({
      ref: 'origin/feat/foo',
      sha: commitSha,
      kind: 'remote-branch',
      remote: 'origin',
    });
  });

  it('surfaces refs/remotes/<remote>/HEAD as kind `remote-head`', async () => {
    const refs = await listRefs(repo);
    const head = refs.remoteBranches.find((r) => r.ref === 'origin/HEAD');
    expect(head).toEqual({
      ref: 'origin/HEAD',
      sha: commitSha,
      kind: 'remote-head',
      remote: 'origin',
    });
  });
});

describe('listRefs — multi-remote', () => {
  let repo: string;
  let commitSha: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-list-refs-multi-remote-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    await writeFile(join(repo, 'a.txt'), 'one\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    commitSha = await git(repo, ['rev-parse', 'HEAD']);
    await git(repo, ['update-ref', 'refs/remotes/origin/main', commitSha]);
    await git(repo, ['update-ref', 'refs/remotes/upstream/main', commitSha]);
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('enumerates entries from all remotes with the correct `remote` field', async () => {
    const refs = await listRefs(repo);
    const remotes = new Set(refs.remoteBranches.map((r) => r.remote));
    expect(remotes).toEqual(new Set(['origin', 'upstream']));
    const upstream = refs.remoteBranches.find(
      (r) => r.ref === 'upstream/main',
    );
    expect(upstream?.remote).toBe('upstream');
  });
});

describe('listRefs — tags', () => {
  let repo: string;
  let commitSha: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-list-refs-tags-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    await writeFile(join(repo, 'a.txt'), 'one\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    commitSha = await git(repo, ['rev-parse', 'HEAD']);
    await git(repo, ['tag', '-a', 'v1.0.0', '-m', 'annotated']);
    await git(repo, ['tag', 'light-1.0', 'HEAD']);
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('distinguishes annotated vs lightweight tags via `kind`', async () => {
    const refs = await listRefs(repo);
    const byName = new Map(refs.tags.map((t) => [t.ref, t]));
    expect(byName.get('v1.0.0')).toEqual({
      ref: 'v1.0.0',
      sha: commitSha,
      kind: 'tag-annotated',
    });
    expect(byName.get('light-1.0')).toEqual({
      ref: 'light-1.0',
      sha: commitSha,
      kind: 'tag-lightweight',
    });
  });
});
