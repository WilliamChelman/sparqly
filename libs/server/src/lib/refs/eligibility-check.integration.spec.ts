import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasGitHistoryForPathspec } from './eligibility-check';

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

describe('hasGitHistoryForPathspec', () => {
  let repo: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-eligibility-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    await writeFile(join(repo, 'committed.ttl'), 'c\n');
    await writeFile(join(repo, 'deleted.ttl'), 'd\n');
    await writeFile(join(repo, '.gitignore'), 'ignored.ttl\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'add committed + deleted + gitignore']);

    await git(repo, ['rm', '-q', 'deleted.ttl']);
    await git(repo, ['commit', '-q', '-m', 'remove deleted.ttl']);

    await writeFile(join(repo, 'ignored.ttl'), 'i\n');
    await writeFile(join(repo, 'untracked.ttl'), 'u\n');
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('returns true for a committed file', async () => {
    expect(await hasGitHistoryForPathspec(repo, 'committed.ttl')).toBe(true);
  });

  it('returns true for a file deleted at HEAD but still in history', async () => {
    expect(await hasGitHistoryForPathspec(repo, 'deleted.ttl')).toBe(true);
  });

  it('returns false for a .gitignored file', async () => {
    expect(await hasGitHistoryForPathspec(repo, 'ignored.ttl')).toBe(false);
  });

  it('returns false for an untracked-but-not-ignored file', async () => {
    expect(await hasGitHistoryForPathspec(repo, 'untracked.ttl')).toBe(false);
  });

  it('returns true for a glob pathspec matching committed files', async () => {
    expect(
      await hasGitHistoryForPathspec(repo, ':(glob,top)*.ttl'),
    ).toBe(true);
  });

  it('returns false for a glob pathspec matching no committed files', async () => {
    expect(
      await hasGitHistoryForPathspec(repo, ':(glob,top)nope-*.ttl'),
    ).toBe(false);
  });
});
