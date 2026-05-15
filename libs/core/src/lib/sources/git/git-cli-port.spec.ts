import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitCliPort } from './git-cli-port';

const execFileAsync = promisify(execFile);

async function git(
  repo: string,
  args: ReadonlyArray<string>,
  env?: Record<string, string>,
): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      ...env,
    },
  });
  return stdout.trim();
}

describe('GitCliPort (integration with real fixture repo)', () => {
  let repo: string;
  let commit1Sha: string;
  let commit2Sha: string;
  const port = new GitCliPort();

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-gitport-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    await writeFile(join(repo, 'foaf.ttl'), 'old-content\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    commit1Sha = await git(repo, ['rev-parse', 'HEAD']);
    await git(repo, ['tag', '-a', 'v1.2.0', '-m', 'release v1.2.0']);
    await writeFile(join(repo, 'foaf.ttl'), 'new-content\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'second']);
    commit2Sha = await git(repo, ['rev-parse', 'HEAD']);
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  describe('resolveRefToSha', () => {
    it('resolves a full commit SHA to itself', async () => {
      expect(await port.resolveRefToSha(repo, commit1Sha)).toBe(commit1Sha);
    });

    it('resolves a short commit SHA to the full 40-char SHA', async () => {
      const short = commit1Sha.slice(0, 8);
      expect(await port.resolveRefToSha(repo, short)).toBe(commit1Sha);
    });

    it('resolves an annotated tag to the dereferenced commit SHA', async () => {
      expect(await port.resolveRefToSha(repo, 'v1.2.0')).toBe(commit1Sha);
    });

    it('returns null for an unknown ref', async () => {
      expect(await port.resolveRefToSha(repo, 'v999')).toBeNull();
    });

    it('returns null when repoRoot is not a git repo', async () => {
      const notRepo = await mkdtemp(join(tmpdir(), 'sparqly-notrepo-'));
      try {
        expect(await port.resolveRefToSha(notRepo, commit1Sha)).toBeNull();
      } finally {
        await rm(notRepo, { recursive: true, force: true });
      }
    });
  });

  describe('getRefObjectType', () => {
    it('returns "tag" for an annotated tag', async () => {
      expect(await port.getRefObjectType(repo, 'v1.2.0')).toBe('tag');
    });

    it('returns "commit" for HEAD', async () => {
      expect(await port.getRefObjectType(repo, 'HEAD')).toBe('commit');
    });

    it('returns "commit" for a branch', async () => {
      expect(await port.getRefObjectType(repo, 'main')).toBe('commit');
    });

    it('returns "commit" for HEAD~n', async () => {
      expect(await port.getRefObjectType(repo, 'HEAD~1')).toBe('commit');
    });

    it('returns "commit" for a full SHA', async () => {
      expect(await port.getRefObjectType(repo, commit1Sha)).toBe('commit');
    });

    it('returns "commit" for a lightweight tag', async () => {
      await git(repo, ['tag', 'light-1.0', commit1Sha]);
      expect(await port.getRefObjectType(repo, 'light-1.0')).toBe('commit');
    });

    it('returns null for an unknown ref', async () => {
      expect(await port.getRefObjectType(repo, 'v999')).toBeNull();
    });
  });

  describe('readFileAtSha', () => {
    it("reads the file content from the git tree at the given SHA, ignoring the working tree", async () => {
      const buf = await port.readFileAtSha(repo, commit1Sha, 'foaf.ttl');
      if (buf === null) throw new Error('expected buf, got null');
      expect(buf.toString('utf8')).toBe('old-content\n');
    });

    it('reads the head commit content at its SHA', async () => {
      const buf = await port.readFileAtSha(repo, commit2Sha, 'foaf.ttl');
      if (buf === null) throw new Error('expected buf, got null');
      expect(buf.toString('utf8')).toBe('new-content\n');
    });

    it('returns null for a path absent at the given SHA', async () => {
      expect(await port.readFileAtSha(repo, commit1Sha, 'missing.ttl')).toBeNull();
    });
  });
});
