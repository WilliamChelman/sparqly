import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type CreatedServer } from '../bootstrap';
import type { SourceRow } from './source-row-projector';

interface Harness {
  server: CreatedServer;
  base: string;
  dir: string;
  cleanup: () => Promise<void>;
}

async function startHarness(
  sources: ReadonlyArray<Record<string, unknown>>,
  options: { readOnly?: boolean; sseHeartbeatMs?: number } = {},
): Promise<Harness> {
  Logger.overrideLogger(false);
  const dir = await mkdtemp(join(tmpdir(), 'sparqly-sources-controller-'));
  const server = await createServer({
    sources: sources as Parameters<typeof createServer>[0]['sources'],
    port: 0,
    readOnly: options.readOnly,
    sseHeartbeatMs: options.sseHeartbeatMs,
  });
  return {
    server,
    base: `http://localhost:${server.port}`,
    dir,
    cleanup: async () => {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function fetchRows(base: string): Promise<SourceRow[]> {
  const resp = await fetch(`${base}/api/sources`);
  expect(resp.status).toBe(200);
  return (await resp.json()) as SourceRow[];
}

/**
 * Streaming SSE reader for the in-process Nest harness — pure `fetch()` +
 * `ReadableStream`, no third-party EventSource. Yields parsed event blocks
 * (each `id:` + `event:` + `data:` block separated by a blank line) until
 * the caller closes the iterator or the connection drops. Mirrors only the
 * fields the Sources page cares about; comment-line heartbeats (`:keep-
 * alive\n`) surface as `{ comment: true }` so the heartbeat-test can
 * assert on them.
 */
interface ParsedSseEvent {
  id?: string;
  event?: string;
  data?: string;
  /** True for SSE comment lines (`: ...` keep-alives). */
  comment?: true;
}

async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ParsedSseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let blockEnd: number;
      while ((blockEnd = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, blockEnd);
        buffer = buffer.slice(blockEnd + 2);
        yield parseEventBlock(block);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseEventBlock(block: string): ParsedSseEvent {
  const out: ParsedSseEvent = {};
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) {
      out.comment = true;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon);
    const value = line.slice(colon + 1).replace(/^ /, '');
    if (field === 'id') out.id = value;
    else if (field === 'event') out.event = value;
    else if (field === 'data') out.data = (out.data ?? '') + value;
  }
  return out;
}

describe('GET /api/sources — Sources page snapshot (#353)', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness) await harness.cleanup();
    harness = undefined;
  });

  it('returns one Layer 1 row per served entry, in registry order', async () => {
    harness = await startHarness([
      { id: 'blank', empty: true },
      { id: 'remote', endpoint: 'https://example.org/sparql' },
    ]);
    const rows = await fetchRows(harness.base);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toEqual(['blank', 'remote']);
  });

  it('projects an empty source as in-memory not-loaded under lazy materialization', async () => {
    harness = await startHarness([{ id: 'blank', empty: true }]);
    const [row] = await fetchRows(harness.base);
    expect(row).toEqual({
      mode: 'in-memory',
      id: 'blank',
      kind: 'empty',
      state: 'not-loaded',
    });
  });

  it('projects an endpoint source without a state-machine field', async () => {
    harness = await startHarness([
      { id: 'remote', endpoint: 'https://example.org/sparql' },
    ]);
    const [row] = await fetchRows(harness.base);
    expect(row).toEqual({
      mode: 'endpoint',
      id: 'remote',
      kind: 'endpoint',
    });
    expect('state' in row).toBe(false);
  });

  it('surfaces the Default source flag on the marked entry only', async () => {
    harness = await startHarness([
      { id: 'a', empty: true, default: true },
      { id: 'b', empty: true },
    ]);
    const rows = await fetchRows(harness.base);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId['a'].default).toBe(true);
    expect('default' in byId['b']).toBe(false);
  });

  it('skips reference sources (they are not served — CONTEXT.md, Served registry)', async () => {
    harness = await startHarness([
      { id: 'a', empty: true },
      // Bare `@id` string is parsed as a `kind: 'reference'` alias entry —
      // CONTEXT.md, **Source registry**: references are not themselves data.
      '@a',
    ]);
    const rows = await fetchRows(harness.base);
    expect(rows.map((r) => r.id)).toEqual(['a']);
  });

  it('opening /api/sources triggers zero lazy loads — the rows still report not-loaded after the snapshot', async () => {
    harness = await startHarness([{ id: 'blank', empty: true }]);
    const before = await fetchRows(harness.base);
    expect(before[0]).toMatchObject({
      mode: 'in-memory',
      state: 'not-loaded',
    });
    // A second snapshot still observes `not-loaded` — the first call did not
    // kick a materialization (ADR-0031 contract preserved).
    const after = await fetchRows(harness.base);
    expect(after[0]).toMatchObject({
      mode: 'in-memory',
      state: 'not-loaded',
    });
  });

  it('remains available without sources.allowAdminActions (snapshot is never gated — ADR-0045)', async () => {
    harness = await startHarness([{ id: 'blank', empty: true }], {
      readOnly: true,
    });
    const resp = await fetch(`${harness.base}/api/sources`);
    expect(resp.status).toBe(200);
    const rows = (await resp.json()) as SourceRow[];
    expect(rows.map((r) => r.id)).toEqual(['blank']);
  });

  it('projects a glob source as in-memory not-loaded with kind glob', async () => {
    harness = await startHarness([{ id: 'docs', empty: true }]);
    // The 'empty' covers Layer 1 of in-memory; we add a glob fixture too so
    // the snapshot's row kind discrimination is exercised end-to-end.
    await harness.cleanup();
    harness = undefined;

    const dir = await mkdtemp(join(tmpdir(), 'sparqly-sources-glob-'));
    try {
      await writeFile(
        join(dir, 'data.ttl'),
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
      );
      Logger.overrideLogger(false);
      const server = await createServer({
        sources: [{ id: 'docs', glob: join(dir, '*.ttl') }],
        port: 0,
      });
      try {
        const rows = (await (
          await fetch(`http://localhost:${server.port}/api/sources`)
        ).json()) as SourceRow[];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({
          mode: 'in-memory',
          id: 'docs',
          kind: 'glob',
          state: 'not-loaded',
        });
      } finally {
        await server.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('GET /api/sources/stream — Sources page SSE (#354)', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness) await harness.cleanup();
    harness = undefined;
  });

  it('responds with text/event-stream and a 200 status', async () => {
    harness = await startHarness([{ id: 'blank', empty: true }]);
    const controller = new AbortController();
    try {
      const resp = await fetch(`${harness.base}/api/sources/stream`, {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });
      expect(resp.status).toBe(200);
      expect(resp.headers.get('content-type')).toMatch(/text\/event-stream/);
    } finally {
      controller.abort();
    }
  });

  it('publishes a Source load state transition as an SSE event with a monotonic id and the full SourceRow as data', async () => {
    // A glob source with one ttl file; touching it via /api/sparql kicks
    // EngineMap.ensure(), which fires `load-start` then `load-success`.
    // The broker projects each to a SourceRow and the SSE route writes
    // them as `id: N\ndata: {...row...}\n\n` frames.
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-sources-sse-'));
    try {
      await writeFile(
        join(dir, 'data.ttl'),
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
      );
      Logger.overrideLogger(false);
      const server = await createServer({
        sources: [{ id: 'docs', glob: join(dir, '*.ttl') }],
        port: 0,
        sseHeartbeatMs: 5_000, // long enough not to interleave
      });
      const controller = new AbortController();
      try {
        const base = `http://localhost:${server.port}`;
        const resp = await fetch(`${base}/api/sources/stream`, {
          signal: controller.signal,
          headers: { Accept: 'text/event-stream' },
        });
        // Kick the load so transitions flow into the stream. The fetch
        // happens after the subscription so the live$ subject hands the
        // event to our reader.
        void fetch(`${base}/api/sparql/docs?query=${
          encodeURIComponent('SELECT * WHERE { ?s ?p ?o }')
        }`);
        const rows: { id: string; data: SourceRow }[] = [];
        for await (const ev of readSseEvents(resp.body!)) {
          if (ev.event === 'heartbeat') continue;
          if (ev.id === undefined || ev.data === undefined) continue;
          rows.push({ id: ev.id, data: JSON.parse(ev.data) as SourceRow });
          if (rows.length >= 2) break;
        }
        // Two transitions: load-start (loading) then load-success (loaded).
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.id)).toEqual(['1', '2']);
        expect(rows[0].data.id).toBe('docs');
        if (rows[0].data.mode === 'in-memory') {
          expect(rows[0].data.state).toBe('loading');
        } else {
          throw new Error('expected in-memory row');
        }
        if (rows[1].data.mode === 'in-memory') {
          expect(rows[1].data.state).toBe('loaded');
        } else {
          throw new Error('expected in-memory row');
        }
      } finally {
        controller.abort();
        await server.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('remains available without sources.allowAdminActions (stream is never gated — ADR-0045)', async () => {
    harness = await startHarness([{ id: 'blank', empty: true }], {
      readOnly: true,
      sseHeartbeatMs: 30,
    });
    const controller = new AbortController();
    try {
      const resp = await fetch(`${harness.base}/api/sources/stream`, {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });
      expect(resp.status).toBe(200);
      expect(resp.headers.get('content-type')).toMatch(/text\/event-stream/);
      // Read one heartbeat to prove the stream is alive end-to-end, not
      // just open-but-rejected.
      let sawHeartbeat = false;
      for await (const ev of readSseEvents(resp.body!)) {
        if (ev.event === 'heartbeat') {
          sawHeartbeat = true;
          break;
        }
      }
      expect(sawHeartbeat).toBe(true);
    } finally {
      controller.abort();
    }
  });

  it('replays buffered transitions on reconnect with Last-Event-ID', async () => {
    // Connection A reads two transitions (load-start id=1, load-success id=2),
    // then drops. Connection B reconnects with `Last-Event-ID: 1`; the broker
    // replays id=2 from the ring buffer before resuming live delivery
    // (ADR-0044, #354).
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-sources-sse-'));
    try {
      await writeFile(
        join(dir, 'data.ttl'),
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
      );
      Logger.overrideLogger(false);
      const server = await createServer({
        sources: [{ id: 'docs', glob: join(dir, '*.ttl') }],
        port: 0,
        sseHeartbeatMs: 5_000,
      });
      const base = `http://localhost:${server.port}`;
      const ctlA = new AbortController();
      try {
        const respA = await fetch(`${base}/api/sources/stream`, {
          signal: ctlA.signal,
          headers: { Accept: 'text/event-stream' },
        });
        void fetch(
          `${base}/api/sparql/docs?query=${
            encodeURIComponent('SELECT * WHERE { ?s ?p ?o }')
          }`,
        );
        const seenA: string[] = [];
        for await (const ev of readSseEvents(respA.body!)) {
          if (ev.event === 'heartbeat') continue;
          if (ev.id === undefined) continue;
          seenA.push(ev.id);
          if (seenA.length >= 2) break;
        }
        expect(seenA).toEqual(['1', '2']);
      } finally {
        ctlA.abort();
      }

      const ctlB = new AbortController();
      try {
        const respB = await fetch(`${base}/api/sources/stream`, {
          signal: ctlB.signal,
          headers: {
            Accept: 'text/event-stream',
            'Last-Event-ID': '1',
          },
        });
        let replayed: { id: string; row: SourceRow } | undefined;
        for await (const ev of readSseEvents(respB.body!)) {
          if (ev.event === 'heartbeat') continue;
          if (ev.id === undefined || ev.data === undefined) continue;
          replayed = { id: ev.id, row: JSON.parse(ev.data) as SourceRow };
          break;
        }
        expect(replayed?.id).toBe('2');
        expect(replayed?.row.id).toBe('docs');
        if (replayed?.row.mode === 'in-memory') {
          expect(replayed.row.state).toBe('loaded');
        } else {
          throw new Error('expected in-memory row');
        }
      } finally {
        ctlB.abort();
        await server.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('emits a refetch-snapshot sentinel when Last-Event-ID falls below the ring horizon', async () => {
    // Two glob sources × (load-start + load-success) = 4 transitions. A ring
    // capacity of 1 evicts ids 1-3, leaving oldestId=4. A reconnect with
    // `Last-Event-ID: 1` is then unbridgeable, so the broker writes the
    // `refetch-snapshot` sentinel envelope (ADR-0044) telling the client to
    // re-fetch `GET /api/sources` before resuming the live stream.
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-sources-sse-'));
    try {
      await writeFile(
        join(dir, 'a.ttl'),
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
      );
      await writeFile(
        join(dir, 'b.ttl'),
        '@prefix ex: <http://example.org/> . ex:c ex:p ex:d .',
      );
      Logger.overrideLogger(false);
      const server = await createServer({
        sources: [
          { id: 'a', glob: join(dir, 'a.ttl') },
          { id: 'b', glob: join(dir, 'b.ttl') },
        ],
        port: 0,
        sseHeartbeatMs: 5_000,
        sseRingCapacity: 1,
      });
      const base = `http://localhost:${server.port}`;
      const ctlA = new AbortController();
      try {
        const respA = await fetch(`${base}/api/sources/stream`, {
          signal: ctlA.signal,
          headers: { Accept: 'text/event-stream' },
        });
        // Kick both loads — 4 transitions land in the ring.
        void fetch(
          `${base}/api/sparql/a?query=${
            encodeURIComponent('SELECT * WHERE { ?s ?p ?o }')
          }`,
        );
        void fetch(
          `${base}/api/sparql/b?query=${
            encodeURIComponent('SELECT * WHERE { ?s ?p ?o }')
          }`,
        );
        const seenA: string[] = [];
        for await (const ev of readSseEvents(respA.body!)) {
          if (ev.event === 'heartbeat') continue;
          if (ev.id === undefined) continue;
          seenA.push(ev.id);
          if (seenA.length >= 4) break;
        }
        expect(seenA).toHaveLength(4);
      } finally {
        ctlA.abort();
      }

      const ctlB = new AbortController();
      try {
        const respB = await fetch(`${base}/api/sources/stream`, {
          signal: ctlB.signal,
          headers: {
            Accept: 'text/event-stream',
            'Last-Event-ID': '1',
          },
        });
        let firstNonHeartbeat: ParsedSseEvent | undefined;
        for await (const ev of readSseEvents(respB.body!)) {
          if (ev.event === 'heartbeat') continue;
          if (ev.id === undefined && ev.event === undefined && ev.data === undefined) continue;
          firstNonHeartbeat = ev;
          break;
        }
        expect(firstNonHeartbeat?.event).toBe('refetch-snapshot');
        expect(firstNonHeartbeat?.data).toBeDefined();
        expect(JSON.parse(firstNonHeartbeat!.data!)).toEqual({
          sentinel: 'refetch-snapshot',
        });
      } finally {
        ctlB.abort();
        await server.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('GET /api/config exposes sourcesAdmin.allowAdminActions: true by default (#356)', async () => {
    harness = await startHarness([{ id: 'blank', empty: true }]);
    const resp = await fetch(`${harness.base}/api/config`);
    const json = (await resp.json()) as {
      sourcesAdmin?: { allowAdminActions?: boolean };
    };
    // The capability rides under a sibling key alongside the existing
    // `sources` listing array. Mirrors the `savedQueries: { writable }`
    // precedent (ADR-0036) — one cluster object per capability domain.
    expect(json.sourcesAdmin?.allowAdminActions).toBe(true);
  });

  it('GET /api/config exposes sourcesAdmin.allowAdminActions: false under serve --read-only (#356, ADR-0045)', async () => {
    harness = await startHarness([{ id: 'blank', empty: true }], {
      readOnly: true,
    });
    const resp = await fetch(`${harness.base}/api/config`);
    const json = (await resp.json()) as {
      sourcesAdmin?: { allowAdminActions?: boolean };
    };
    expect(json.sourcesAdmin?.allowAdminActions).toBe(false);
  });

  it('emits a periodic heartbeat that survives an idle connection (no transitions in flight)', async () => {
    harness = await startHarness([{ id: 'blank', empty: true }], {
      // 30ms keeps the test snappy; in production it is 15s.
      sseHeartbeatMs: 30,
    });
    const controller = new AbortController();
    try {
      const resp = await fetch(`${harness.base}/api/sources/stream`, {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });
      expect(resp.body).not.toBeNull();
      const events = readSseEvents(resp.body!);
      const beats: ParsedSseEvent[] = [];
      for await (const ev of events) {
        if (ev.event === 'heartbeat') beats.push(ev);
        if (beats.length >= 2) break;
      }
      expect(beats).toHaveLength(2);
    } finally {
      controller.abort();
    }
  });
});

describe('In-memory admin actions — POST /api/sources/:id/{load,reload,unload} (#356)', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness) await harness.cleanup();
    harness = undefined;
  });

  async function loadFixtureHarness(
    options: { readOnly?: boolean } = {},
  ): Promise<Harness & { fixtureDir: string }> {
    Logger.overrideLogger(false);
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-sources-admin-'));
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const server = await createServer({
      sources: [{ id: 'docs', glob: join(dir, '*.ttl') }],
      port: 0,
      readOnly: options.readOnly,
    });
    return {
      server,
      base: `http://localhost:${server.port}`,
      dir,
      fixtureDir: dir,
      cleanup: async () => {
        await server.close();
        await rm(dir, { recursive: true, force: true });
      },
    };
  }

  it('POST /api/sources/:id/load returns 202 Accepted with { id, state: "loaded" } after warming the in-memory entry', async () => {
    harness = await loadFixtureHarness();
    const resp = await fetch(`${harness.base}/api/sources/docs/load`, {
      method: 'POST',
    });
    expect(resp.status).toBe(202);
    const json = (await resp.json()) as { id: string; state: string };
    expect(json).toEqual({ id: 'docs', state: 'loaded' });
    // The snapshot now reflects the warmed state — the route did the load,
    // not just returned a stale state-machine label.
    const [row] = await fetchRows(harness.base);
    expect(row.mode).toBe('in-memory');
    if (row.mode === 'in-memory') expect(row.state).toBe('loaded');
  });

  it('POST /api/sources/:id/reload returns 202 Accepted with the post-reload state', async () => {
    harness = await loadFixtureHarness();
    // Warm the entry first so reload exercises the atomic-swap path, not the
    // first-load fall-through.
    await fetch(`${harness.base}/api/sources/docs/load`, { method: 'POST' });
    const resp = await fetch(`${harness.base}/api/sources/docs/reload`, {
      method: 'POST',
    });
    expect(resp.status).toBe(202);
    const json = (await resp.json()) as { id: string; state: string };
    expect(json).toEqual({ id: 'docs', state: 'loaded' });
  });

  it('POST /api/sources/:id/unload returns 202 Accepted with { id, state: "not-loaded" }', async () => {
    harness = await loadFixtureHarness();
    await fetch(`${harness.base}/api/sources/docs/load`, { method: 'POST' });
    const resp = await fetch(`${harness.base}/api/sources/docs/unload`, {
      method: 'POST',
    });
    expect(resp.status).toBe(202);
    const json = (await resp.json()) as { id: string; state: string };
    expect(json).toEqual({ id: 'docs', state: 'not-loaded' });
    // Snapshot agrees — the entry is back at rest.
    const [row] = await fetchRows(harness.base);
    if (row.mode !== 'in-memory') throw new Error('expected in-memory row');
    expect(row.state).toBe('not-loaded');
  });

  it('the mutating routes return 403 Forbidden when sourcesAdmin.allowAdminActions is false (ADR-0045)', async () => {
    harness = await loadFixtureHarness({ readOnly: true });
    for (const verb of ['load', 'reload', 'unload']) {
      const resp = await fetch(
        `${harness.base}/api/sources/docs/${verb}`,
        { method: 'POST' },
      );
      expect(resp.status, `verb ${verb}`).toBe(403);
    }
    // And the snapshot still works — read-only monitoring keeps working.
    const [row] = await fetchRows(harness.base);
    if (row.mode !== 'in-memory') throw new Error('expected in-memory row');
    expect(row.state).toBe('not-loaded');
  });

  it('POST /load on an unknown @id returns 404 — the cascade caller must not silently warm a wrong source', async () => {
    harness = await loadFixtureHarness();
    const resp = await fetch(
      `${harness.base}/api/sources/no-such-id/load`,
      { method: 'POST' },
    );
    expect(resp.status).toBe(404);
  });
});
