import { execFile } from 'node:child_process';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type CreatedServer } from '../bootstrap';

async function startEmptyTurtleEndpoint(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const stub: HttpServer = createHttpServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/turtle' });
      res.end('');
    });
  });
  await new Promise<void>((resolve) =>
    stub.listen(0, '127.0.0.1', () => resolve()),
  );
  const addr = stub.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/sparql`,
    close: () => new Promise<void>((resolve) => stub.close(() => resolve())),
  };
}

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
    server = await createServer({
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

  it('returns the leaf glob refs for a view whose `from:` chain bottoms on a glob', async () => {
    server = await createServer({
      sources: [
        { id: 'docs', glob: join(repo, '*.ttl') },
        {
          id: 'kept',
          from: '@docs',
          query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        },
      ],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/kept/refs`,
    );
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      head: { ref: string; kind: string; sha: string };
      branches: Array<{ ref: string }>;
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
    server = await createServer({
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

  it('returns 404 { error: "no-git-repo", kind: "endpoint" } for a view whose `from:` chain bottoms on an endpoint', async () => {
    const stub = await startEmptyTurtleEndpoint();
    try {
      server = await createServer({
        sources: [
          { id: 'live', endpoint: stub.url },
          {
            id: 'composed',
            from: '@live',
            query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
          },
        ],
        port: 0,
      });
      const resp = await fetch(
        `http://localhost:${server.port}/api/sources/composed/refs`,
      );
      expect(resp.status).toBe(404);
      const json = (await resp.json()) as { error?: string; kind?: string };
      expect(json.error).toBe('no-git-repo');
      expect(json.kind).toBe('endpoint');
    } finally {
      await stub.close();
    }
  });

  it('returns 404 { error: "no-git-repo", kind: "empty" } for an empty source', async () => {
    server = await createServer({
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

  it('returns 404 { error: "no-git-repo", kind: "empty" } for a view whose `from:` chain bottoms on an empty source', async () => {
    server = await createServer({
      sources: [
        { id: 'blank', empty: true },
        {
          id: 'composed',
          from: '@blank',
          query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        },
      ],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/composed/refs`,
    );
    expect(resp.status).toBe(404);
    const json = (await resp.json()) as { error?: string; kind?: string };
    expect(json.error).toBe('no-git-repo');
    expect(json.kind).toBe('empty');
  });

  it('returns the parent glob refs for a split-glob file child', async () => {
    server = await createServer({
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

  it('returns the leaf glob refs for a multi-hop view chain (view → view → glob)', async () => {
    server = await createServer({
      sources: [
        { id: 'docs', glob: join(repo, '*.ttl') },
        {
          id: 'mid',
          from: '@docs',
          query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        },
        {
          id: 'top',
          from: '@mid',
          query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        },
      ],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/top/refs`,
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
    server = await createServer({
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
    server = await createServer({
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
    server = await createServer({
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
    server = await createServer({
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

  it('fetches the leaf glob refs for a view whose `from:` chain bottoms on a glob', async () => {
    server = await createServer({
      sources: [
        { id: 'docs', glob: join(repo, '*.ttl') },
        {
          id: 'kept',
          from: '@docs',
          query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        },
      ],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/kept/refs/fetch`,
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
    server = await createServer({
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
    server = await createServer({
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
