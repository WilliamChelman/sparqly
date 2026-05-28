import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listCommits } from './list-commits';

const execFileAsync = promisify(execFile);

async function git(repo: string, args: ReadonlyArray<string>): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Alice Tester',
      GIT_AUTHOR_EMAIL: 'alice@example.com',
      GIT_COMMITTER_NAME: 'Alice Tester',
      GIT_COMMITTER_EMAIL: 'alice@example.com',
    },
  });
  return stdout.trim();
}

describe('listCommits — happy path on a linear history', () => {
  let repo: string;
  const shas: string[] = [];

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-list-commits-tracer-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    for (let i = 1; i <= 3; i++) {
      await writeFile(join(repo, 'a.txt'), `version-${i}\n`);
      await git(repo, ['add', '.']);
      await git(repo, ['commit', '-q', '-m', `change ${i}`]);
      shas.push(await git(repo, ['rev-parse', 'HEAD']));
    }
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('returns commits touching the pathspec in newest-first order with full shape', async () => {
    const r = await listCommits(repo, {
      ref: 'HEAD',
      pathspec: 'a.txt',
      limit: 50,
    });
    expect(r.isOk()).toBe(true);
    const result = r._unsafeUnwrap();

    expect(result.nextBefore).toBeNull();
    expect(result.commits).toHaveLength(3);

    // newest-first order
    expect(result.commits.map((c) => c.sha)).toEqual([
      shas[2],
      shas[1],
      shas[0],
    ]);

    const newest = result.commits[0];
    expect(newest.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(newest.shortSha).toBe(shas[2].slice(0, 7));
    expect(newest.subject).toBe('change 3');
    expect(newest.authorName).toBe('Alice Tester');
    expect(newest.authorDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(newest.parents).toEqual([shas[1]]);

    const oldest = result.commits[2];
    expect(oldest.parents).toEqual([]);
  });

  it('caps the page size at `limit` newest-first', async () => {
    const r = await listCommits(repo, {
      ref: 'HEAD',
      pathspec: 'a.txt',
      limit: 2,
    });
    expect(r._unsafeUnwrap().commits.map((c) => c.sha)).toEqual([
      shas[2],
      shas[1],
    ]);
  });

  it('returns err({ kind: "bad-ref" }) for an unknown ref', async () => {
    const r = await listCommits(repo, {
      ref: 'no-such-ref',
      pathspec: 'a.txt',
      limit: 50,
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toEqual({ kind: 'bad-ref' });
  });
});

describe('listCommits — cursor pagination', () => {
  let repo: string;
  const shas: string[] = [];

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-list-commits-cursor-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    for (let i = 1; i <= 5; i++) {
      await writeFile(join(repo, 'a.txt'), `v${i}\n`);
      await git(repo, ['add', '.']);
      await git(repo, ['commit', '-q', '-m', `change ${i}`]);
      shas.push(await git(repo, ['rev-parse', 'HEAD']));
    }
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('emits nextBefore = last returned SHA when more pages remain', async () => {
    // Page 1: limit=2 on a 5-commit history → returns newest 2,
    // nextBefore = SHA of the 2nd-newest (the last returned row).
    const r = await listCommits(repo, {
      ref: 'HEAD',
      pathspec: 'a.txt',
      limit: 2,
    });
    expect(r.isOk()).toBe(true);
    const page1 = r._unsafeUnwrap();
    expect(page1.commits.map((c) => c.sha)).toEqual([shas[4], shas[3]]);
    expect(page1.nextBefore).toBe(shas[3]);
  });

  it('walks from the parent of `before` when provided, with no overlap with the prior page', async () => {
    const page2 = await listCommits(repo, {
      ref: 'HEAD',
      pathspec: 'a.txt',
      limit: 2,
      before: shas[3],
    });
    expect(page2.isOk()).toBe(true);
    const result = page2._unsafeUnwrap();
    // Next two oldest after shas[3]: shas[2], shas[1]
    expect(result.commits.map((c) => c.sha)).toEqual([shas[2], shas[1]]);
    // One commit (shas[0]) still remains → nextBefore = shas[1]
    expect(result.nextBefore).toBe(shas[1]);
  });

  it('emits nextBefore = null on the last page', async () => {
    const last = await listCommits(repo, {
      ref: 'HEAD',
      pathspec: 'a.txt',
      limit: 2,
      before: shas[1],
    });
    expect(last.isOk()).toBe(true);
    const result = last._unsafeUnwrap();
    expect(result.commits.map((c) => c.sha)).toEqual([shas[0]]);
    expect(result.nextBefore).toBeNull();
  });
});

describe('listCommits — pathspec filter', () => {
  let repo: string;
  let touchedSha = '';
  let untouchedSha = '';

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-list-commits-pathspec-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    await writeFile(join(repo, 'a.txt'), 'a1\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'add a']);
    touchedSha = await git(repo, ['rev-parse', 'HEAD']);

    await writeFile(join(repo, 'b.txt'), 'b1\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'add unrelated b']);
    untouchedSha = await git(repo, ['rev-parse', 'HEAD']);
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('excludes commits that do not touch the pathspec', async () => {
    const r = await listCommits(repo, {
      ref: 'HEAD',
      pathspec: 'a.txt',
      limit: 50,
    });
    const shas = r._unsafeUnwrap().commits.map((c) => c.sha);
    expect(shas).toContain(touchedSha);
    expect(shas).not.toContain(untouchedSha);
  });
});
