import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type CreatedServer } from '../bootstrap';
import type { SourceRow } from './source-row-projector';
import type { BuildChild, SpawnIndexBuild } from '../bootstrap/index-build-pool';
import { ensureGlobIndex, diskBackedIndexIdentity, globIndexDir, parseSourceSpecs } from 'core';

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
      // Layer 4 (#359) — Endpoint source rows ship the endpoint URL so the
      // page chip can render which remote the row points at.
      endpointUrl: 'https://example.org/sparql',
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

  it('nests split-glob File children under their meta `children` array; children do not appear at the top level (#361)', async () => {
    // A split-glob meta with 2 matched .ttl files exposes them as synthesized
    // **File source** children (ADR-0027). On the **Sources page** they are
    // not rendered as siblings — they collapse under one disclosable meta row.
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-sources-split-snap-'));
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
          { id: 'docs', glob: join(dir, '*.ttl'), splitByFile: true },
        ],
        port: 0,
      });
      try {
        const rows = (await (
          await fetch(`http://localhost:${server.port}/api/sources`)
        ).json()) as SourceRow[];
        // One row at the top level: the meta.
        expect(rows.map((r) => r.id)).toEqual(['docs']);
        const [meta] = rows;
        expect(meta.mode).toBe('in-memory');
        if (meta.mode !== 'in-memory') throw new Error('narrow');
        // The meta carries its children verbatim.
        expect(meta.children).toBeDefined();
        const childIds = (meta.children ?? []).map((c) => c.id).sort();
        expect(childIds).toEqual(['docs/a.ttl', 'docs/b.ttl']);
        // Each child carries its own state + parentId, identical to what a
        // standalone row of the same shape would look like.
        for (const child of meta.children ?? []) {
          if (child.mode !== 'in-memory') throw new Error('narrow');
          expect(child.state).toBe('not-loaded');
          expect(child.parentId).toBe('docs');
          expect(child.kind).toBe('file');
        }
      } finally {
        await server.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

  it('projects a split-glob parent-union load as a meta row carrying children, reaching loaded (broker parity with snapshot)', async () => {
    // Querying `?source=docs` loads the parent union (distinct from the per-file
    // children). The broker must publish the *meta* row — children folded in,
    // parent-union state winning — identical to the snapshot, so the Sources
    // page flips to `loaded` live instead of lingering on `not-loaded`.
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-sources-sse-split-'));
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
        sources: [{ id: 'docs', glob: join(dir, '*.ttl'), splitByFile: true }],
        port: 0,
        sseHeartbeatMs: 5_000,
      });
      const controller = new AbortController();
      try {
        const base = `http://localhost:${server.port}`;
        const resp = await fetch(`${base}/api/sources/stream`, {
          signal: controller.signal,
          headers: { Accept: 'text/event-stream' },
        });
        void fetch(
          `${base}/api/sparql/docs?query=${encodeURIComponent('SELECT * WHERE { ?s ?p ?o }')}`,
        );
        const rows: { id: string; data: SourceRow }[] = [];
        for await (const ev of readSseEvents(resp.body!)) {
          if (ev.event === 'heartbeat') continue;
          if (ev.id === undefined || ev.data === undefined) continue;
          rows.push({ id: ev.id, data: JSON.parse(ev.data) as SourceRow });
          if (rows.length >= 2) break;
        }
        expect(rows).toHaveLength(2);
        // Every emitted row is the `docs` meta — never an orphan child row.
        expect(rows.map((r) => r.data.id)).toEqual(['docs', 'docs']);
        const last = rows[1].data;
        if (last.mode !== 'in-memory') throw new Error('expected in-memory row');
        expect(last.state).toBe('loaded');
        // Children are folded into the live meta row, as in the snapshot.
        expect((last.children ?? []).map((c) => c.id).sort()).toEqual([
          'docs/a.ttl',
          'docs/b.ttl',
        ]);
      } finally {
        controller.abort();
        await server.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('routes a split-glob child transition to its parent meta row (no orphan child row)', async () => {
    // Loading a single child (`?source=docs/a.ttl`) must refresh the `docs`
    // meta, not publish a top-level `docs/a.ttl` row the snapshot never emits.
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-sources-sse-child-'));
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
        sources: [{ id: 'docs', glob: join(dir, '*.ttl'), splitByFile: true }],
        port: 0,
        sseHeartbeatMs: 5_000,
      });
      const controller = new AbortController();
      try {
        const base = `http://localhost:${server.port}`;
        const resp = await fetch(`${base}/api/sources/stream`, {
          signal: controller.signal,
          headers: { Accept: 'text/event-stream' },
        });
        void fetch(
          `${base}/api/sparql/${encodeURIComponent('docs/a.ttl')}?query=${encodeURIComponent('SELECT * WHERE { ?s ?p ?o }')}`,
        );
        const rows: SourceRow[] = [];
        for await (const ev of readSseEvents(resp.body!)) {
          if (ev.event === 'heartbeat') continue;
          if (ev.id === undefined || ev.data === undefined) continue;
          rows.push(JSON.parse(ev.data) as SourceRow);
          if (rows.length >= 2) break;
        }
        // Both transitions surface as the parent meta, never `docs/a.ttl`.
        expect(rows.map((r) => r.id)).toEqual(['docs', 'docs']);
        const last = rows[1];
        if (last.mode !== 'in-memory') throw new Error('expected in-memory row');
        // Parent union itself untouched → children aggregation: one loaded, one
        // not → 'mixed', with the loaded child reflected in the breakdown.
        expect(last.state).toBe('mixed');
        const loadedChild = (last.children ?? []).find(
          (c) => c.id === 'docs/a.ttl',
        );
        if (loadedChild?.mode !== 'in-memory') throw new Error('narrow child');
        expect(loadedChild.state).toBe('loaded');
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

describe('Disk-backed (Re)build / Cancel — POST and DELETE /api/sources/:id/index-build (#358)', () => {
  let harness: DiskHarness | undefined;
  afterEach(async () => {
    if (harness) await harness.cleanup();
    harness = undefined;
  });

  interface DiskHarness {
    server: CreatedServer;
    base: string;
    /** Forces `child.exit(code)` on the latest spawn for `sourceId`. */
    settle: (sourceId: string, code: number | null) => void;
    /** Latest spawned child's `killed` signal, or `undefined`. */
    killed: (sourceId: string) => 'SIGTERM' | undefined;
    /** Source ids spawn was called for, in order. */
    spawned: () => string[];
    cleanup: () => Promise<void>;
  }

  /**
   * Controllable {@link BuildChild} stub for controller-level tests. The test
   * drives `exit` and observes `killed` so the assertions don't race a real
   * subprocess. Mirrors the `StubBuildChild` pattern from `engine-map.spec.ts`
   * with an added `runRealBuild()` hook the freshness-path test uses to
   * actually populate the on-disk manifest under the test's `configDir`.
   */
  class ControlledChild implements BuildChild {
    private readonly exitListeners: Array<(code: number | null) => void> = [];
    private readonly errorListeners: Array<(err: Error) => void> = [];
    killed: 'SIGTERM' | undefined;
    on(event: 'exit', listener: (code: number | null) => void): void;
    on(event: 'error', listener: (err: Error) => void): void;
    on(
      event: 'exit' | 'error',
      listener: ((code: number | null) => void) | ((err: Error) => void),
    ): void {
      if (event === 'exit') this.exitListeners.push(listener as (c: number | null) => void);
      else this.errorListeners.push(listener as (e: Error) => void);
    }
    kill(signal: 'SIGTERM'): void {
      this.killed = signal;
    }
    fireExit(code: number | null): void {
      for (const l of this.exitListeners) l(code);
    }
  }

  async function startDiskHarness(
    options: {
      readOnly?: boolean;
      /** Run the real build inline before firing exit(0) on success path. */
      runRealBuild?: boolean;
    } = {},
  ): Promise<DiskHarness> {
    Logger.overrideLogger(false);
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-disk-build-'));
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const children = new Map<string, ControlledChild>();
    const spawned: string[] = [];
    // The registry the server will see — used by the spawn stub to resolve
    // the same `indexDir` the EngineMap routes against, so the realBuild
    // path writes a manifest the controller's snapshot endpoint can read.
    const registry = parseSourceSpecs([
      { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
    ]);
    const spawn: SpawnIndexBuild = (id) => {
      spawned.push(id);
      const child = new ControlledChild();
      children.set(id, child);
      if (options.runRealBuild) {
        const source = registry.find((s) => s.id === id);
        if (source && (source.kind === 'glob' || source.kind === 'file')) {
          const { indexId, pattern } = diskBackedIndexIdentity(source);
          const indexDir = globIndexDir(dir, indexId, undefined);
          void ensureGlobIndex({
            glob: pattern,
            transforms: source.transforms ?? [],
            indexDir,
            sparqlyVersion: 'test',
          }).then((outcome) => child.fireExit(outcome.isOk() ? 0 : 1));
        }
      }
      return child;
    };
    const server = await createServer({
      sources: [{ id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' }],
      port: 0,
      readOnly: options.readOnly,
      configDir: dir,
      spawnIndexBuild: spawn,
    });
    return {
      server,
      base: `http://localhost:${server.port}`,
      settle: (id, code) => children.get(id)?.fireExit(code),
      killed: (id) => children.get(id)?.killed,
      spawned: () => spawned,
      cleanup: async () => {
        await server.close();
        await rm(dir, { recursive: true, force: true });
      },
    };
  }

  it('POST /api/sources/:id/index-build returns 202 Accepted and spawns a child build', async () => {
    harness = await startDiskHarness();
    const resp = await fetch(`${harness.base}/api/sources/big/index-build`, {
      method: 'POST',
    });
    expect(resp.status).toBe(202);
    expect(harness.spawned()).toEqual(['big']);
    // Drain so the harness shutdown doesn't race the in-flight child.
    harness.settle('big', null);
  });

  it('POST returns 403 Forbidden when sources.allowAdminActions is false (ADR-0045)', async () => {
    harness = await startDiskHarness({ readOnly: true });
    const resp = await fetch(`${harness.base}/api/sources/big/index-build`, {
      method: 'POST',
    });
    expect(resp.status).toBe(403);
    // Capability gate fires before the pool — no spawn happens.
    expect(harness.spawned()).toEqual([]);
  });

  it('POST is idempotent during an in-flight build — second POST returns 202 without a second spawn', async () => {
    harness = await startDiskHarness();
    const first = await fetch(`${harness.base}/api/sources/big/index-build`, {
      method: 'POST',
    });
    expect(first.status).toBe(202);
    const second = await fetch(`${harness.base}/api/sources/big/index-build`, {
      method: 'POST',
    });
    expect(second.status).toBe(202);
    // Coalesced — the in-flight child handles both triggers.
    expect(harness.spawned()).toEqual(['big']);
    harness.settle('big', null);
  });

  it('POST after a non-zero exit clears the sticky-failed marker and respawns — Retry is the user-explicit recovery path (#360)', async () => {
    harness = await startDiskHarness();
    const first = await fetch(`${harness.base}/api/sources/big/index-build`, {
      method: 'POST',
    });
    expect(first.status).toBe(202);
    // The build child exits non-zero — the entry enters sticky-failed and
    // the pool records a post-failure cooldown for 'big'. Under #360 the
    // explicit Retry path bypasses the cooldown and clears the sticky.
    harness.settle('big', 1);
    // Wait one microtask flush so the settle handler runs before the POST.
    await new Promise((r) => setImmediate(r));
    const retry = await fetch(`${harness.base}/api/sources/big/index-build`, {
      method: 'POST',
    });
    expect(retry.status).toBe(202);
    // A second child was spawned — the user clicked Retry.
    expect(harness.spawned()).toEqual(['big', 'big']);
    // Settle the Retry child so the harness's `server.close()` (which
    // SIGTERMs and awaits running children) can drain in `afterEach`.
    harness.settle('big', null);
  });

  it('DELETE /api/sources/:id/index-build SIGTERMs the in-flight child and returns 202 Accepted', async () => {
    harness = await startDiskHarness();
    await fetch(`${harness.base}/api/sources/big/index-build`, {
      method: 'POST',
    });
    const resp = await fetch(`${harness.base}/api/sources/big/index-build`, {
      method: 'DELETE',
    });
    expect(resp.status).toBe(202);
    expect(harness.killed('big')).toBe('SIGTERM');
    // Drain the cancelled child so the server can shut down cleanly.
    harness.settle('big', null);
  });

  it('DELETE returns 403 Forbidden when sources.allowAdminActions is false', async () => {
    harness = await startDiskHarness({ readOnly: true });
    const resp = await fetch(`${harness.base}/api/sources/big/index-build`, {
      method: 'DELETE',
    });
    expect(resp.status).toBe(403);
  });

  it('DELETE with nothing in flight returns 202 (no-op satisfies the user intent)', async () => {
    harness = await startDiskHarness();
    const resp = await fetch(`${harness.base}/api/sources/big/index-build`, {
      method: 'DELETE',
    });
    expect(resp.status).toBe(202);
    expect(harness.killed('big')).toBeUndefined();
  });

  it('POST /api/sources/:id/index-build on an in-memory source returns 400 — Rebuild is disk-backed-only (ADR-0043)', async () => {
    Logger.overrideLogger(false);
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-disk-build-mem-'));
    try {
      await writeFile(
        join(dir, 'a.ttl'),
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
      );
      const server = await createServer({
        sources: [{ id: 'mem', glob: join(dir, '*.ttl') }],
        port: 0,
      });
      try {
        const resp = await fetch(
          `http://localhost:${server.port}/api/sources/mem/index-build`,
          { method: 'POST' },
        );
        expect(resp.status).toBe(400);
      } finally {
        await server.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('POST on an unknown @id returns 404 — the action menu and the URL must agree on registry membership', async () => {
    harness = await startDiskHarness();
    const resp = await fetch(
      `${harness.base}/api/sources/no-such-id/index-build`,
      { method: 'POST' },
    );
    expect(resp.status).toBe(404);
  });
});

describe('Endpoint Test connection — POST /api/sources/:id/test-connection (#359)', () => {
  /**
   * Throwaway local HTTP endpoint that answers SPARQL `ASK` either with
   * `{ boolean: true }` (`mode: 'ok'`), with HTTP 500 (`mode: 'fail'`), or
   * never responds — the harness aborts on cleanup (`mode: 'hang'`). The
   * test wraps every assertion in a try/finally that calls `close()` so a
   * crashing assertion never leaks a port.
   */
  async function startFakeEndpoint(
    mode: 'ok' | 'fail',
  ): Promise<{ url: string; asks: number; close: () => Promise<void> }> {
    const { createServer: createHttp } = await import('node:http');
    const state = { asks: 0 };
    const server = createHttp((req, res) => {
      state.asks += 1;
      if (mode === 'fail') {
        res.writeHead(500);
        res.end('boom');
        return;
      }
      // Comunica may probe with an empty service-description GET before the
      // real query. Either way we just answer `{ boolean: true }` — the
      // probe only cares that the round-trip succeeded.
      res.writeHead(200, {
        'Content-Type': 'application/sparql-results+json',
      });
      res.end(JSON.stringify({ head: {}, boolean: true }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    return {
      url: `http://127.0.0.1:${port}/sparql`,
      get asks() {
        return state.asks;
      },
      close: () =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  let cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const c of cleanup) await c();
    cleanup = [];
  });

  it('returns 200 OK with { ok: true, latencyMs } when the endpoint answers the ASK', async () => {
    const ep = await startFakeEndpoint('ok');
    cleanup.push(ep.close);
    Logger.overrideLogger(false);
    const server = await createServer({
      sources: [{ id: 'remote', endpoint: ep.url }],
      port: 0,
    });
    cleanup.push(() => server.close());
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/remote/test-connection`,
      { method: 'POST' },
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      ok: boolean;
      latencyMs: number;
    };
    expect(body.ok).toBe(true);
    expect(typeof body.latencyMs).toBe('number');
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
    // The route really probed the endpoint — a memoized verdict from boot
    // would record zero ASKs at this point.
    expect(ep.asks).toBeGreaterThanOrEqual(1);
  });

  it('returns 200 OK with { ok: false, error: { kind, message } } when the endpoint fails', async () => {
    const ep = await startFakeEndpoint('fail');
    cleanup.push(ep.close);
    Logger.overrideLogger(false);
    const server = await createServer({
      sources: [{ id: 'remote', endpoint: ep.url }],
      port: 0,
    });
    cleanup.push(() => server.close());
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/remote/test-connection`,
      { method: 'POST' },
    );
    // The probe succeeded — it reached the endpoint and learned it is sick.
    // 200 OK with `ok: false` is the chip-rendering contract; a 5xx here
    // would be a category error (the probe itself didn't fail, the
    // endpoint did).
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      ok: boolean;
      error?: { kind: string; message: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error?.kind).toBe('endpoint-fetch');
    expect(typeof body.error?.message).toBe('string');
  });

  it('returns 403 Forbidden when sources.allowAdminActions is false (ADR-0045 — endpoint hammering guard)', async () => {
    // PRD user story 41: the Test connection button is gated by the
    // capability flag so a public viewer can't hammer the endpoint
    // 100×/second by clicking the button.
    const ep = await startFakeEndpoint('ok');
    cleanup.push(ep.close);
    Logger.overrideLogger(false);
    const server = await createServer({
      sources: [{ id: 'remote', endpoint: ep.url }],
      port: 0,
      readOnly: true,
    });
    cleanup.push(() => server.close());
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/remote/test-connection`,
      { method: 'POST' },
    );
    expect(resp.status).toBe(403);
    // Capability gate fires before the probe — no ASK reached the endpoint.
    expect(ep.asks).toBe(0);
  });

  it('returns 404 Not Found for an unknown @id', async () => {
    const ep = await startFakeEndpoint('ok');
    cleanup.push(ep.close);
    Logger.overrideLogger(false);
    const server = await createServer({
      sources: [{ id: 'remote', endpoint: ep.url }],
      port: 0,
    });
    cleanup.push(() => server.close());
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/no-such-id/test-connection`,
      { method: 'POST' },
    );
    expect(resp.status).toBe(404);
  });

  it('returns 404 Not Found for a non-endpoint @id (Test connection is endpoint-only — PRD AC)', async () => {
    // PRD acceptance criterion #2: "404 Not Found for non-endpoint ids".
    // The verb is endpoint-only; from the route's perspective, an
    // in-memory or disk-backed entry is "no such endpoint with that id".
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-test-conn-mem-'));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    Logger.overrideLogger(false);
    const server = await createServer({
      sources: [{ id: 'mem', glob: join(dir, '*.ttl') }],
      port: 0,
    });
    cleanup.push(() => server.close());
    const resp = await fetch(
      `http://localhost:${server.port}/api/sources/mem/test-connection`,
      { method: 'POST' },
    );
    expect(resp.status).toBe(404);
  });
});
