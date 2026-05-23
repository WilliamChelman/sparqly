import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServe, type ServeHandle } from './helpers/serve';

/**
 * Issue #362 — end-to-end coverage for the Source admin actions capability
 * (`sources.allowAdminActions`, ADR-0045) under `serve --read-only`, plus the
 * complementary contract that the lazy-build-on-first-touch path (ADR-0031)
 * is unaffected by the capability being off.
 *
 * Three scenarios per the issue's acceptance criteria:
 *
 * 1. `serve --read-only` exposes `sourcesAdmin.allowAdminActions: false` on
 *    `/api/config`; every mutating route returns `403 Forbidden`; the
 *    snapshot endpoint and the SSE stream still work.
 * 2. A first-touch query against a `not-built` Disk-backed glob still kicks
 *    the auto-build via the normal query-resolution path, even with the
 *    capability off.
 * 3. A rebuild against a `ready` disk-backed source (with the capability on)
 *    ends with a new manifest and a `ready` state. (The mid-flight cancel
 *    path is covered at the unit level by `index-build-pool.spec.ts`.)
 */

const SAMPLE_TTL = '@prefix ex: <http://example.org/> .\nex:a ex:p ex:b .\n';

interface ConfigEnvelope {
  sourcesAdmin?: { allowAdminActions?: boolean };
  savedQueries?: { writable?: boolean };
}

interface SnapshotRow {
  id: string;
  mode: 'in-memory' | 'disk-backed' | 'endpoint';
  state?: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchConfig(baseUrl: string): Promise<ConfigEnvelope> {
  const resp = await fetch(`${baseUrl}/api/config`);
  expect(resp.status).toBe(200);
  return (await resp.json()) as ConfigEnvelope;
}

async function fetchRows(baseUrl: string): Promise<SnapshotRow[]> {
  const resp = await fetch(`${baseUrl}/api/sources`);
  expect(resp.status).toBe(200);
  return (await resp.json()) as SnapshotRow[];
}

async function readFirstSseEvent(
  baseUrl: string,
): Promise<{ status: number; contentType: string | null; sawAnyEvent: boolean }> {
  const controller = new AbortController();
  try {
    const resp = await fetch(`${baseUrl}/api/sources/stream`, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
    });
    const status = resp.status;
    const contentType = resp.headers.get('content-type');
    if (!resp.body) return { status, contentType, sawAnyEvent: false };
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const deadline = Date.now() + 8000;
    let sawAnyEvent = false;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // A heartbeat block or a real event block — either proves the stream is
      // live end-to-end, not just `200` and silent.
      if (buffer.includes('\n\n') || buffer.includes(':')) {
        sawAnyEvent = true;
        break;
      }
    }
    return { status, contentType, sawAnyEvent };
  } finally {
    controller.abort();
  }
}

describe('sparqly serve --read-only — Sources admin actions capability (#362)', () => {
  let projectRoot: string;
  let handle: ServeHandle | undefined;

  beforeEach(async () => {
    projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'sparqly-sources-readonly-e2e-')),
    );
    // `.git` boundary stops config auto-discovery from walking onto the host.
    await mkdir(join(projectRoot, '.git'));
    await mkdir(join(projectRoot, 'data'));
  });

  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('exposes sourcesAdmin.allowAdminActions:false on /api/config, refuses every mutating route with 403, and still serves /api/sources + the SSE stream', async () => {
    await writeFile(join(projectRoot, 'data', 'a.ttl'), SAMPLE_TTL);
    const configPath = join(projectRoot, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: mem
            glob: data/*.ttl
          - id: disk
            glob: data/*.ttl
            storage: disk
      ` + '\n',
    );

    handle = await startServe(['--config', configPath, '--read-only'], {
      cwd: projectRoot,
    });

    // Capability flag is published — webapp reads this once at boot to gate UI.
    const config = await fetchConfig(handle.baseUrl);
    expect(config.sourcesAdmin?.allowAdminActions).toBe(false);

    // Every mutating route is 403'd at the controller before any side effects.
    const mutating: Array<{ method: string; path: string }> = [
      { method: 'POST', path: '/api/sources/mem/load' },
      { method: 'POST', path: '/api/sources/mem/reload' },
      { method: 'POST', path: '/api/sources/mem/unload' },
      { method: 'POST', path: '/api/sources/disk/index-build' },
      { method: 'DELETE', path: '/api/sources/disk/index-build' },
      { method: 'POST', path: '/api/sources/mem/test-connection' },
    ];
    for (const { method, path } of mutating) {
      const resp = await fetch(`${handle.baseUrl}${path}`, { method });
      expect(resp.status, `${method} ${path}`).toBe(403);
    }

    // Snapshot is never gated — read-only monitoring keeps working.
    const rows = await fetchRows(handle.baseUrl);
    expect(rows.map((r) => r.id).sort()).toEqual(['disk', 'mem']);

    // The SSE stream is never gated either — live dashboards keep ticking.
    const stream = await readFirstSseEvent(handle.baseUrl);
    expect(stream.status).toBe(200);
    expect(stream.contentType).toMatch(/text\/event-stream/);
    expect(stream.sawAnyEvent).toBe(true);
  });

  it('a first-touch query against a not-built disk-backed source still auto-builds in --read-only mode (ADR-0031 contract preserved)', async () => {
    // The lazy-build-on-first-touch path is the only way a public read-only
    // deployment ever materializes a disk-backed index — the operator can't
    // click Rebuild because the capability is off. The query route is
    // unaffected by `sources.allowAdminActions`; only the operator-initiated
    // page actions are gated.
    await mkdir(join(projectRoot, 'mem-data'));
    await writeFile(join(projectRoot, 'data', 'a.ttl'), SAMPLE_TTL);
    await writeFile(join(projectRoot, 'mem-data', 'b.ttl'), SAMPLE_TTL);
    const configPath = join(projectRoot, 'sparqly.config.yaml');
    // `mem` is the default so the serve helper's boot probe touches the
    // in-memory source — leaving `disk` genuinely `not-built` until the
    // first explicit query against `/api/sparql/disk` lands below.
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: mem
            glob: mem-data/*.ttl
            default: true
          - id: disk
            glob: data/*.ttl
            storage: disk
      ` + '\n',
    );

    handle = await startServe(['--config', configPath, '--read-only'], {
      cwd: projectRoot,
    });

    // Pre-touch the disk row reports `not-built` — no boot-time build kicked.
    const before = await fetchRows(handle.baseUrl);
    const diskBefore = before.find((r) => r.id === 'disk');
    expect(diskBefore?.mode).toBe('disk-backed');
    expect(diskBefore?.state).toBe('not-built');

    // First-touch query. The first call returns 503 (indexing) per ADR-0042;
    // the side effect is that a `sparqly index disk` child gets spawned.
    const firstQuery = await fetch(
      `${handle.baseUrl}/api/sparql/disk?query=${encodeURIComponent('ASK { ?s ?p ?o }')}`,
    );
    expect([200, 503]).toContain(firstQuery.status);

    // Poll until the build settles. The on-disk manifest is the durable
    // signal — when the snapshot also flips to `ready`, we know the
    // EngineMap's state has caught up too. Both must hold for the contract
    // to be intact in read-only mode.
    const manifestPath = join(
      projectRoot,
      '.sparqly',
      'index',
      'disk',
      'manifest.json',
    );
    const deadline = Date.now() + 15_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (await exists(manifestPath)) {
        const rows = await fetchRows(handle.baseUrl);
        const diskRow = rows.find((r) => r.id === 'disk');
        if (diskRow?.state === 'ready') {
          ready = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(ready, 'expected disk-backed source to auto-build to ready').toBe(true);

    // A follow-up query now succeeds — the lazy-built index serves it.
    const followUp = await fetch(
      `${handle.baseUrl}/api/sparql/disk?query=${encodeURIComponent('ASK { ?s ?p ?o }')}`,
    );
    expect(followUp.status).toBe(200);
    const body = (await followUp.json()) as { boolean: boolean };
    expect(body.boolean).toBe(true);
  });

  it('POST /api/sources/:id/index-build against a ready disk-backed source produces a new manifest and a ready state (capability on)', async () => {
    // The mid-flight cancel path (manifest intact + temp directory swept) is
    // covered at the unit level by `index-build-pool.spec.ts` — driving the
    // exact timing through a real spawned child in E2E is too racy on a
    // sub-second build.
    await writeFile(join(projectRoot, 'data', 'a.ttl'), SAMPLE_TTL);
    const configPath = join(projectRoot, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: disk
            glob: data/*.ttl
            storage: disk
      ` + '\n',
    );

    handle = await startServe(['--config', configPath], { cwd: projectRoot });

    const manifestPath = join(
      projectRoot,
      '.sparqly',
      'index',
      'disk',
      'manifest.json',
    );

    // First-touch via the boot probe + a direct query — wait for the source
    // to settle into `ready` so the next POST exercises the rebuild path,
    // not the first-build path.
    await fetch(
      `${handle.baseUrl}/api/sparql/disk?query=${encodeURIComponent('ASK { ?s ?p ?o }')}`,
    );
    const readyDeadline = Date.now() + 15_000;
    while (Date.now() < readyDeadline) {
      if (await exists(manifestPath)) {
        const rows = await fetchRows(handle.baseUrl);
        if (rows[0]?.state === 'ready') break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    const priorRows = await fetchRows(handle.baseUrl);
    expect(priorRows[0].state).toBe('ready');
    const priorMtime = (await stat(manifestPath)).mtimeMs;

    // mtime resolution on macOS APFS is sub-millisecond but writeFile bursts
    // can land on the same tick — give the next manifest a clean delta.
    await new Promise((r) => setTimeout(r, 50));

    // Operator-initiated rebuild. 202 Accepted is the contract — the HTTP
    // call returns immediately, the child runs in the background.
    const rebuild = await fetch(
      `${handle.baseUrl}/api/sources/disk/index-build`,
      { method: 'POST' },
    );
    expect(rebuild.status).toBe(202);

    // Wait for the rebuild to settle back to `ready` with a newer manifest.
    const rebuildDeadline = Date.now() + 15_000;
    let rebuilt = false;
    while (Date.now() < rebuildDeadline) {
      if (await exists(manifestPath)) {
        const mtime = (await stat(manifestPath)).mtimeMs;
        const rows = await fetchRows(handle.baseUrl);
        if (mtime > priorMtime && rows[0]?.state === 'ready') {
          rebuilt = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(rebuilt, 'expected rebuild to produce a newer manifest + ready state').toBe(true);
  });
});
