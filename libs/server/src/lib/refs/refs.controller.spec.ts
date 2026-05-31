import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, type CreatedServer } from '../bootstrap/create-test-server';

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

describe('GET /api/sources/:id/refs', () => {
  let repo: string;
  let server: CreatedServer | undefined;

  beforeEach(async () => {
    Logger.overrideLogger(false);
    repo = await mkdtemp(join(tmpdir(), 'sparqly-refs-route-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    await writeFile(join(repo, 'a.ttl'), '@prefix : <#> . :s :p :o .\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
  });

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
    await rm(repo, { recursive: true, force: true });
  });

  it('returns the sectioned response shape for a glob source', async () => {
    server = await createTestServer({
      sources: [{ id: 'alpha', glob: join(repo, '*.ttl') }],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/alpha/refs`,
    );
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      head: { ref: string; kind: string; sha: string };
      branches: Array<{ ref: string; kind: string }>;
      remoteBranches: unknown[];
      tags: unknown[];
    };
    expect(json.head.ref).toBe('HEAD');
    expect(json.head.kind).toBe('head');
    expect(json.head.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(json.branches.map((b) => b.ref)).toEqual(['main']);
    expect(json.remoteBranches).toEqual([]);
    expect(json.tags).toEqual([]);
  });

  it('returns 404 { error: "no-git-repo", kind: "endpoint" } for an endpoint source', async () => {
    server = await createTestServer({
      sources: [
        { id: 'remote', endpoint: 'https://example.org/sparql' },
      ],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/remote/refs`,
    );
    expect(resp.status).toBe(404);
    const json = (await resp.json()) as { error?: string; kind?: string };
    expect(json.error).toBe('no-git-repo');
    expect(json.kind).toBe('endpoint');
  });

  it('returns 404 { error: "no-git-repo", kind: "empty" } for an empty source', async () => {
    server = await createTestServer({
      sources: [{ id: 'blank', empty: true }],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/blank/refs`,
    );
    expect(resp.status).toBe(404);
    const json = (await resp.json()) as { error?: string; kind?: string };
    expect(json.error).toBe('no-git-repo');
    expect(json.kind).toBe('empty');
  });

  it('returns the parent glob refs for a split-glob file child', async () => {
    server = await createTestServer({
      sources: [
        { id: 'docs', glob: join(repo, '*.ttl'), splitByFile: true },
      ],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/${encodeURIComponent(
        'docs/a.ttl',
      )}/refs`,
    );
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      head: { ref: string; sha: string };
      branches: Array<{ ref: string }>;
    };
    expect(json.head.ref).toBe('HEAD');
    expect(json.head.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(json.branches.map((b) => b.ref)).toEqual(['main']);
  });

  it('returns 404 { error: "pin-unsupported", reason: "storage-disk" } for a disk-backed glob', async () => {
    // The /refs endpoint exists to feed the SourcePicker's pin selector.
    // A disk-backed glob can't be pinned (ADR-0041: the on-disk index is
    // keyed on glob, not SHA; `resolveSourceResult` refuses the combination
    // with a typed `glob-load` error). Returning the ref list anyway would
    // train the UI to offer pin actions that always fail downstream — so
    // the endpoint must mirror the resolve-time refusal here.
    server = await createTestServer({
      sources: [
        { id: 'docs', glob: join(repo, '*.ttl'), storage: 'disk' },
      ],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/docs/refs`,
    );
    expect(resp.status).toBe(404);
    const json = (await resp.json()) as { error?: string; reason?: string };
    expect(json.error).toBe('pin-unsupported');
    expect(json.reason).toBe('storage-disk');
  });

  it('returns 404 { error: "no-git-history" } for a glob pattern with zero history', async () => {
    server = await createTestServer({
      sources: [{ id: 'docs', glob: join(repo, 'no-such-*.ttl') }],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/docs/refs`,
    );
    expect(resp.status).toBe(404);
    const json = (await resp.json()) as { error?: string };
    expect(json.error).toBe('no-git-history');
  });

  it('returns 404 { error: "no-git-history" } for a .gitignored file', async () => {
    await writeFile(join(repo, '.gitignore'), 'secret.ttl\n');
    await git(repo, ['add', '.gitignore']);
    await git(repo, ['commit', '-q', '-m', 'add gitignore']);
    await writeFile(join(repo, 'secret.ttl'), '@prefix : <#> . :s :p :o .\n');

    server = await createTestServer({
      sources: [{ id: 'docs', glob: join(repo, 'secret.ttl') }],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/docs/refs`,
    );
    expect(resp.status).toBe(404);
    const json = (await resp.json()) as { error?: string };
    expect(json.error).toBe('no-git-history');
  });

  it('returns 404 { error: "no-git-history" } for an untracked-but-not-ignored file', async () => {
    await writeFile(join(repo, 'fresh.ttl'), '@prefix : <#> . :s :p :o .\n');
    server = await createTestServer({
      sources: [{ id: 'docs', glob: join(repo, 'fresh.ttl') }],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/docs/refs`,
    );
    expect(resp.status).toBe(404);
    const json = (await resp.json()) as { error?: string };
    expect(json.error).toBe('no-git-history');
  });

  it('still serves refs when a file was deleted at HEAD but exists in history', async () => {
    await writeFile(join(repo, 'doomed.ttl'), '@prefix : <#> . :s :p :o .\n');
    await git(repo, ['add', 'doomed.ttl']);
    await git(repo, ['commit', '-q', '-m', 'add doomed']);
    await git(repo, ['rm', '-q', 'doomed.ttl']);
    await git(repo, ['commit', '-q', '-m', 'remove doomed']);

    server = await createTestServer({
      sources: [{ id: 'docs', glob: join(repo, 'doomed.ttl') }],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/docs/refs`,
    );
    expect(resp.status).toBe(200);
  });

  it('pin-unsupported takes precedence over no-git-history for a disk glob with no history', async () => {
    server = await createTestServer({
      sources: [
        { id: 'docs', glob: join(repo, 'no-such-*.ttl'), storage: 'disk' },
      ],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/docs/refs`,
    );
    expect(resp.status).toBe(404);
    const json = (await resp.json()) as { error?: string; reason?: string };
    expect(json.error).toBe('pin-unsupported');
    expect(json.reason).toBe('storage-disk');
  });

  it('returns 404 no-git-history for a split-glob child whose resolved file has no history', async () => {
    await writeFile(join(repo, 'zzz.ttl'), '@prefix : <#> . :s :p :o .\n');
    server = await createTestServer({
      sources: [
        { id: 'docs', glob: join(repo, '*.ttl'), splitByFile: true },
      ],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/${encodeURIComponent(
        'docs/zzz.ttl',
      )}/refs`,
    );
    expect(resp.status).toBe(404);
    const json = (await resp.json()) as { error?: string };
    expect(json.error).toBe('no-git-history');
  });

});

describe('GET /api/sources/:id/commits', () => {
  let repo: string;
  let shas: string[] = [];
  let server: CreatedServer | undefined;

  beforeEach(async () => {
    Logger.overrideLogger(false);
    shas = [];
    repo = await mkdtemp(join(tmpdir(), 'sparqly-commits-route-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    for (let i = 1; i <= 3; i++) {
      await writeFile(join(repo, 'a.ttl'), `@prefix : <#> . :s :p :o${i} .\n`);
      await git(repo, ['add', '.']);
      await git(repo, ['commit', '-q', '-m', `change ${i}`]);
      shas.push(await git(repo, ['rev-parse', 'HEAD']));
    }
  });

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
    await rm(repo, { recursive: true, force: true });
  });

  it('returns { commits, nextBefore: null } for a glob with history', async () => {
    server = await createTestServer({
      sources: [{ id: 'alpha', glob: join(repo, '*.ttl') }],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/alpha/commits?ref=HEAD`,
    );
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      commits: Array<{
        sha: string;
        shortSha: string;
        subject: string;
        authorName: string;
        authorDate: string;
        parents: string[];
      }>;
      nextBefore: string | null;
    };
    expect(json.nextBefore).toBeNull();
    expect(json.commits.map((c) => c.sha)).toEqual([
      shas[2],
      shas[1],
      shas[0],
    ]);
    const newest = json.commits[0];
    expect(newest.shortSha).toBe(shas[2].slice(0, 7));
    expect(newest.subject).toBe('change 3');
    expect(newest.authorName).toBe('test');
    expect(newest.authorDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(newest.parents).toEqual([shas[1]]);
  });

  it('returns 404 { error: "pin-unsupported", reason: "storage-disk" } for a disk-backed glob', async () => {
    server = await createTestServer({
      sources: [
        { id: 'docs', glob: join(repo, '*.ttl'), storage: 'disk' },
      ],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/docs/commits?ref=HEAD`,
    );
    expect(resp.status).toBe(404);
    const json = (await resp.json()) as { error?: string; reason?: string };
    expect(json.error).toBe('pin-unsupported');
    expect(json.reason).toBe('storage-disk');
  });

  it('returns 400 { error: "invalid-scope" } for a scope that is not HEAD, __all__, or a listed ref', async () => {
    server = await createTestServer({
      sources: [{ id: 'alpha', glob: join(repo, '*.ttl') }],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/alpha/commits?ref=no-such-ref`,
    );
    expect(resp.status).toBe(400);
    const json = (await resp.json()) as { error?: string };
    expect(json.error).toBe('invalid-scope');
  });

  it('returns 400 { error: "invalid-scope" } for a 40-hex SHA scope value', async () => {
    server = await createTestServer({
      sources: [{ id: 'alpha', glob: join(repo, '*.ttl') }],
      port: 0,
    });
    // shas[1] is a real commit object — but scope is a *named* viewpoint,
    // not a SHA. The endpoint must reject it.
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/alpha/commits?ref=${shas[1]}`,
    );
    expect(resp.status).toBe(400);
    const json = (await resp.json()) as { error?: string };
    expect(json.error).toBe('invalid-scope');
  });

  it('returns commits for the resolved file path for a split-glob child', async () => {
    await writeFile(join(repo, 'b.ttl'), '@prefix : <#> . :s :p :o2 .\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'add b']);

    server = await createTestServer({
      sources: [
        { id: 'docs', glob: join(repo, '*.ttl'), splitByFile: true },
      ],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/${encodeURIComponent(
        'docs/a.ttl',
      )}/commits?ref=HEAD`,
    );
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      commits: Array<{ sha: string; subject: string }>;
    };
    // a.ttl was touched by the 3 initial commits, not the "add b" commit
    expect(json.commits.map((c) => c.sha)).toEqual([
      shas[2],
      shas[1],
      shas[0],
    ]);
  });

  it('returns commits reachable from a named branch scope only', async () => {
    // Branch off the first commit and add a commit on `side` that does not
    // exist on main. Asking for scope=side returns the side-only commit
    // alongside the shared ancestor; the main-only commits are excluded.
    await git(repo, ['checkout', '-q', '-b', 'side', shas[0]]);
    await writeFile(join(repo, 'a.ttl'), '@prefix : <#> . :s :p :side .\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'side change']);
    const sideSha = await git(repo, ['rev-parse', 'HEAD']);
    await git(repo, ['checkout', '-q', 'main']);

    server = await createTestServer({
      sources: [{ id: 'alpha', glob: join(repo, '*.ttl') }],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/alpha/commits?ref=side`,
    );
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      commits: Array<{ sha: string }>;
    };
    const returned = json.commits.map((c) => c.sha);
    expect(returned).toContain(sideSha);
    expect(returned).toContain(shas[0]);
    expect(returned).not.toContain(shas[1]);
    expect(returned).not.toContain(shas[2]);
  });

  it('paginates with limit + before cursor: round-trips page 1 → page 2 with no row overlap and stable ordering', async () => {
    // Add two more commits so we have 5 total touching a.ttl.
    for (let i = 4; i <= 5; i++) {
      await writeFile(join(repo, 'a.ttl'), `@prefix : <#> . :s :p :o${i} .\n`);
      await git(repo, ['add', '.']);
      await git(repo, ['commit', '-q', '-m', `change ${i}`]);
      shas.push(await git(repo, ['rev-parse', 'HEAD']));
    }

    server = await createTestServer({
      sources: [{ id: 'alpha', glob: join(repo, '*.ttl') }],
      port: 0,
    });

    const page1Resp = await fetch(
      `http://localhost:${server.port}/api/sources/alpha/commits?ref=HEAD&limit=2`,
    );
    expect(page1Resp.status).toBe(200);
    const page1 = (await page1Resp.json()) as {
      commits: Array<{ sha: string }>;
      nextBefore: string | null;
    };
    // Newest 2 of 5: shas[4], shas[3]
    expect(page1.commits.map((c) => c.sha)).toEqual([shas[4], shas[3]]);
    expect(page1.nextBefore).toBe(shas[3]);

    const page2Resp = await fetch(
      `http://localhost:${server.port}/api/sources/alpha/commits?ref=HEAD&limit=2&before=${page1.nextBefore}`,
    );
    expect(page2Resp.status).toBe(200);
    const page2 = (await page2Resp.json()) as {
      commits: Array<{ sha: string }>;
      nextBefore: string | null;
    };
    // Next 2 older: shas[2], shas[1]; one remains so nextBefore = shas[1]
    expect(page2.commits.map((c) => c.sha)).toEqual([shas[2], shas[1]]);
    expect(page2.nextBefore).toBe(shas[1]);

    // No overlap between pages.
    const p1Set = new Set(page1.commits.map((c) => c.sha));
    for (const c of page2.commits) expect(p1Set.has(c.sha)).toBe(false);

    // Final page: one row left, nextBefore null.
    const page3Resp = await fetch(
      `http://localhost:${server.port}/api/sources/alpha/commits?ref=HEAD&limit=2&before=${page2.nextBefore}`,
    );
    const page3 = (await page3Resp.json()) as {
      commits: Array<{ sha: string }>;
      nextBefore: string | null;
    };
    expect(page3.commits.map((c) => c.sha)).toEqual([shas[0]]);
    expect(page3.nextBefore).toBeNull();
  });

  it('defaults limit to 50 when the query param is omitted', async () => {
    server = await createTestServer({
      sources: [{ id: 'alpha', glob: join(repo, '*.ttl') }],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/alpha/commits?ref=HEAD`,
    );
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      commits: Array<{ sha: string }>;
      nextBefore: string | null;
    };
    // Only 3 commits total — well under default 50; nextBefore null.
    expect(json.commits).toHaveLength(3);
    expect(json.nextBefore).toBeNull();
  });

  it('returns 400 { error: "invalid-before" } when before is not a 40-hex SHA', async () => {
    server = await createTestServer({
      sources: [{ id: 'alpha', glob: join(repo, '*.ttl') }],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/alpha/commits?ref=HEAD&before=not-a-sha`,
    );
    expect(resp.status).toBe(400);
    const json = (await resp.json()) as { error?: string };
    expect(json.error).toBe('invalid-before');
  });

  it('returns commits across all refs for scope=__all__, including side-branch commits unreachable from HEAD', async () => {
    // Branch off the first commit, add a commit touching the same glob on
    // a side branch that is *not* reachable from HEAD. scope=__all__ must
    // surface it; scope=HEAD does not.
    await git(repo, ['checkout', '-q', '-b', 'side', shas[0]]);
    await writeFile(join(repo, 'a.ttl'), '@prefix : <#> . :s :p :side .\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'side change']);
    const sideSha = await git(repo, ['rev-parse', 'HEAD']);
    await git(repo, ['checkout', '-q', 'main']);

    server = await createTestServer({
      sources: [{ id: 'alpha', glob: join(repo, '*.ttl') }],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/alpha/commits?ref=__all__`,
    );
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      commits: Array<{ sha: string }>;
    };
    const returned = json.commits.map((c) => c.sha);
    expect(returned).toContain(sideSha);
    expect(returned).toContain(shas[2]);

    // HEAD scope must *not* contain the side-branch commit
    const headResp = await fetch(
      `http://localhost:${server.port}/api/sources/alpha/commits?ref=HEAD`,
    );
    const headJson = (await headResp.json()) as {
      commits: Array<{ sha: string }>;
    };
    expect(headJson.commits.map((c) => c.sha)).not.toContain(sideSha);
  });
});

describe('POST /api/sources/:id/refs/fetch', () => {
  let bare: string;
  let repo: string;
  let server: CreatedServer | undefined;

  beforeEach(async () => {
    Logger.overrideLogger(false);
    bare = await mkdtemp(join(tmpdir(), 'sparqly-refs-fetch-bare-'));
    await git(bare, ['init', '-q', '--bare', '-b', 'main']);

    repo = await mkdtemp(join(tmpdir(), 'sparqly-refs-fetch-repo-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    await writeFile(join(repo, 'a.ttl'), '@prefix : <#> . :s :p :o .\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    await git(repo, ['remote', 'add', 'origin', bare]);
    await git(repo, ['push', '-q', 'origin', 'main']);
  });

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
    if (repo) await rm(repo, { recursive: true, force: true });
    if (bare) await rm(bare, { recursive: true, force: true });
  });

  it('returns the post-fetch RefsResponse shape for a glob source', async () => {
    server = await createTestServer({
      sources: [{ id: 'alpha', glob: join(repo, '*.ttl') }],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/alpha/refs/fetch`,
      { method: 'POST' },
    );
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      head: { ref: string; kind: string; sha: string };
      branches: Array<{ ref: string }>;
      remoteBranches: Array<{ ref: string; kind: string; remote: string }>;
      tags: unknown[];
    };
    expect(json.head.ref).toBe('HEAD');
    expect(json.head.kind).toBe('head');
    expect(json.head.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(json.branches.map((b) => b.ref)).toEqual(['main']);
    expect(json.remoteBranches.map((r) => r.ref)).toContain('origin/main');
    expect(json.tags).toEqual([]);
  });

  it('returns 404 { error: "no-git-repo", kind: "endpoint" } for an endpoint source', async () => {
    server = await createTestServer({
      sources: [{ id: 'remote', endpoint: 'https://example.org/sparql' }],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/remote/refs/fetch`,
      { method: 'POST' },
    );
    expect(resp.status).toBe(404);
    const json = (await resp.json()) as { error?: string; kind?: string };
    expect(json.error).toBe('no-git-repo');
    expect(json.kind).toBe('endpoint');
  });

  it('returns 404 { error: "no-git-repo", kind: "empty" } for an empty source', async () => {
    server = await createTestServer({
      sources: [{ id: 'blank', empty: true }],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/blank/refs/fetch`,
      { method: 'POST' },
    );
    expect(resp.status).toBe(404);
    const json = (await resp.json()) as { error?: string; kind?: string };
    expect(json.error).toBe('no-git-repo');
    expect(json.kind).toBe('empty');
  });

  it('fetches the parent glob refs for a split-glob file child', async () => {
    server = await createTestServer({
      sources: [
        { id: 'docs', glob: join(repo, '*.ttl'), splitByFile: true },
      ],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/${encodeURIComponent(
        'docs/a.ttl',
      )}/refs/fetch`,
      { method: 'POST' },
    );
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      branches: Array<{ ref: string }>;
      remoteBranches: Array<{ ref: string }>;
    };
    expect(json.branches.map((b) => b.ref)).toEqual(['main']);
    expect(json.remoteBranches.map((r) => r.ref)).toContain('origin/main');
  });

  it('returns 404 { error: "pin-unsupported", reason: "storage-disk" } on /fetch for a disk-backed glob', async () => {
    server = await createTestServer({
      sources: [
        { id: 'docs', glob: join(repo, '*.ttl'), storage: 'disk' },
      ],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/docs/refs/fetch`,
      { method: 'POST' },
    );
    expect(resp.status).toBe(404);
    const json = (await resp.json()) as { error?: string; reason?: string };
    expect(json.error).toBe('pin-unsupported');
    expect(json.reason).toBe('storage-disk');
  });

});

describe('POST /api/sources/:id/refs/fetch — typed fetch failures', () => {
  let repo: string;
  let server: CreatedServer | undefined;

  beforeEach(async () => {
    Logger.overrideLogger(false);
    repo = await mkdtemp(join(tmpdir(), 'sparqly-refs-fetch-fail-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    await writeFile(join(repo, 'a.ttl'), '@prefix : <#> . :s :p :o .\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
  });

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('surfaces a non-existent remote as a typed `network` HTTP error', async () => {
    await git(repo, [
      'remote',
      'add',
      'origin',
      join(tmpdir(), 'sparqly-refs-fetch-fail-missing-' + Date.now()),
    ]);
    server = await createTestServer({
      sources: [{ id: 'alpha', glob: join(repo, '*.ttl') }],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/alpha/refs/fetch`,
      { method: 'POST' },
    );
    expect(resp.ok).toBe(false);
    const json = (await resp.json()) as { error?: string; kind?: string };
    expect(json.error).toBe('fetch-failed');
    expect(json.kind).toBe('network');
  });

  it('surfaces a repo with no remotes as a typed `no-remote` HTTP error', async () => {
    server = await createTestServer({
      sources: [{ id: 'alpha', glob: join(repo, '*.ttl') }],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/alpha/refs/fetch`,
      { method: 'POST' },
    );
    expect(resp.ok).toBe(false);
    const json = (await resp.json()) as { error?: string; kind?: string };
    expect(json.error).toBe('fetch-failed');
    expect(json.kind).toBe('no-remote');
  });
});
