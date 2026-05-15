import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitCliPort } from './git-cli-port';
import { defaultRepoDiscovery } from './pin-glob-source';
import { walkGitTree } from './walk-git-tree';

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

const TTL = (label: string) =>
  `@prefix ex: <http://example.org/> .\nex:${label} ex:p ex:x .\n`;

describe('walkGitTree — integration (ADR-0029, issue #274)', () => {
  let repo: string;
  let shaV1: string;
  let shaHead: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-walk-git-tree-'));
    await mkdir(join(repo, 'data/sub'), { recursive: true });
    await writeFile(join(repo, 'data/keep.ttl'), TTL('keep'));
    await writeFile(join(repo, 'data/deleted-later.ttl'), TTL('deletedLater'));
    await writeFile(join(repo, 'data/sub/nested.ttl'), TTL('nested'));
    await writeFile(join(repo, 'data/notes.md'), '# notes\n');
    await git(repo, ['init', '-q', '-b', 'main']);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'v1']);
    shaV1 = await git(repo, ['rev-parse', 'HEAD']);

    // After v1: add a new file, delete one.
    await writeFile(join(repo, 'data/added-later.ttl'), TTL('addedLater'));
    await rm(join(repo, 'data/deleted-later.ttl'));
    await git(repo, ['add', '-A']);
    await git(repo, ['commit', '-q', '-m', 'v2']);
    shaHead = await git(repo, ['rev-parse', 'HEAD']);
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('enumerates files matching the glob at v1 SHA — added-later absent, deleted-later present', async () => {
    const result = await walkGitTree(
      {
        glob: join(repo, 'data/**/*.ttl'),
        repoRoot: repo,
        sha: shaV1,
      },
      { gitPort: new GitCliPort(), repoDiscovery: defaultRepoDiscovery },
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    const rel = [...result.value]
      .map((p) => p.slice(repo.length + 1))
      .sort();
    expect(rel).toEqual([
      'data/deleted-later.ttl',
      'data/keep.ttl',
      'data/sub/nested.ttl',
    ]);
  });

  it('enumerates files at HEAD — added-later present, deleted-later absent', async () => {
    const result = await walkGitTree(
      {
        glob: join(repo, 'data/**/*.ttl'),
        repoRoot: repo,
        sha: shaHead,
      },
      { gitPort: new GitCliPort(), repoDiscovery: defaultRepoDiscovery },
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    const rel = [...result.value]
      .map((p) => p.slice(repo.length + 1))
      .sort();
    expect(rel).toEqual([
      'data/added-later.ttl',
      'data/keep.ttl',
      'data/sub/nested.ttl',
    ]);
  });

  it('respects glob patterns (only .ttl, not .md)', async () => {
    const result = await walkGitTree(
      {
        glob: join(repo, 'data/*.ttl'),
        repoRoot: repo,
        sha: shaHead,
      },
      { gitPort: new GitCliPort(), repoDiscovery: defaultRepoDiscovery },
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    const rel = [...result.value]
      .map((p) => p.slice(repo.length + 1))
      .sort();
    // Single-star pattern stays at the top level (excludes sub/, excludes .md).
    expect(rel).toEqual(['data/added-later.ttl', 'data/keep.ttl']);
  });
});
