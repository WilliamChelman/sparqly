import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitCliPort } from './git-cli-port';
import { resolveGitRef } from './resolve-ref';

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

describe('resolveGitRef — classification against a real fixture repo (ADR-0029, #273)', () => {
  let repo: string;
  let commitSha: string;
  const port = new GitCliPort();

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-resolve-ref-int-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    await writeFile(join(repo, 'a.txt'), 'one\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    commitSha = await git(repo, ['rev-parse', 'HEAD']);
    await git(repo, ['tag', '-a', 'v1.0.0', '-m', 'annotated']);
    await git(repo, ['tag', 'light-1.0', 'HEAD']); // lightweight tag
    await writeFile(join(repo, 'a.txt'), 'two\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'second']);
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('classifies a full SHA as pinned', async () => {
    const result = await resolveGitRef(port, repo, commitSha);
    const ok = result._unsafeUnwrap();
    expect(ok.kind).toBe('pinned');
    expect(ok.sha).toBe(commitSha);
    expect(ok.refString).toBe(commitSha);
  });

  it('classifies an annotated tag as pinned', async () => {
    const result = await resolveGitRef(port, repo, 'v1.0.0');
    const ok = result._unsafeUnwrap();
    expect(ok.kind).toBe('pinned');
    expect(ok.sha).toBe(commitSha);
    expect(ok.refString).toBe('v1.0.0');
  });

  it('classifies a branch as floating', async () => {
    const result = await resolveGitRef(port, repo, 'main');
    const ok = result._unsafeUnwrap();
    expect(ok.kind).toBe('floating');
    expect(ok.refString).toBe('main');
    expect(ok.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('classifies HEAD as floating', async () => {
    const result = await resolveGitRef(port, repo, 'HEAD');
    expect(result._unsafeUnwrap().kind).toBe('floating');
  });

  it('classifies HEAD~1 as floating', async () => {
    const result = await resolveGitRef(port, repo, 'HEAD~1');
    const ok = result._unsafeUnwrap();
    expect(ok.kind).toBe('floating');
    expect(ok.sha).toBe(commitSha);
  });

  it('classifies a lightweight tag as floating', async () => {
    const result = await resolveGitRef(port, repo, 'light-1.0');
    const ok = result._unsafeUnwrap();
    expect(ok.kind).toBe('floating');
    expect(ok.sha).toBe(commitSha);
  });

  it('returns an unresolvable-ref error for unknown ref', async () => {
    const result = await resolveGitRef(port, repo, 'v999');
    expect(result._unsafeUnwrapErr().kind).toBe('unresolvable-ref');
  });
});
