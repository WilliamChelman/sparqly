import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listRefs } from './list-refs';
import type { RefsResponse } from './refs-response';

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

function maskShas(refs: RefsResponse): RefsResponse {
  const mask = (s: string): string =>
    /^[0-9a-f]{40}$/.test(s) ? '<SHA>' : s;
  const m = (e: { ref: string; sha: string; kind: string; remote?: string }) =>
    e.remote === undefined
      ? { ref: e.ref, sha: mask(e.sha), kind: e.kind }
      : { ref: e.ref, sha: mask(e.sha), kind: e.kind, remote: e.remote };
  return {
    head: m(refs.head) as RefsResponse['head'],
    branches: refs.branches.map(m) as RefsResponse['branches'],
    remoteBranches: refs.remoteBranches.map(m) as RefsResponse['remoteBranches'],
    tags: refs.tags.map(m) as RefsResponse['tags'],
  };
}

/**
 * Pins the wire shape of GET /api/sources/:id/refs for a representative
 * fixture covering head, branches, remote-tracking branches (incl.
 * remote-head), and both tag flavours. SHAs are masked to `<SHA>` so the
 * golden is stable across runs.
 */
describe('listRefs — golden response shape', () => {
  let repo: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-list-refs-golden-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    await writeFile(join(repo, 'a.txt'), 'one\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    const sha = await git(repo, ['rev-parse', 'HEAD']);
    await git(repo, ['tag', '-a', 'v1.0.0', '-m', 'annotated']);
    await git(repo, ['tag', 'light-1.0', 'HEAD']);
    await git(repo, ['update-ref', 'refs/remotes/origin/main', sha]);
    await git(repo, [
      'symbolic-ref',
      'refs/remotes/origin/HEAD',
      'refs/remotes/origin/main',
    ]);
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('matches the documented sectioned shape', async () => {
    const refs = await listRefs(repo);
    expect(JSON.stringify(maskShas(refs), null, 2)).toBe(
      JSON.stringify(
        {
          head: { ref: 'HEAD', sha: '<SHA>', kind: 'head' },
          branches: [{ ref: 'main', sha: '<SHA>', kind: 'branch' }],
          remoteBranches: [
            {
              ref: 'origin/HEAD',
              sha: '<SHA>',
              kind: 'remote-head',
              remote: 'origin',
            },
            {
              ref: 'origin/main',
              sha: '<SHA>',
              kind: 'remote-branch',
              remote: 'origin',
            },
          ],
          tags: [
            { ref: 'light-1.0', sha: '<SHA>', kind: 'tag-lightweight' },
            { ref: 'v1.0.0', sha: '<SHA>', kind: 'tag-annotated' },
          ],
        },
        null,
        2,
      ),
    );
  });
});
