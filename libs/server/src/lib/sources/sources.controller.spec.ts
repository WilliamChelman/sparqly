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
  options: { readOnly?: boolean } = {},
): Promise<Harness> {
  Logger.overrideLogger(false);
  const dir = await mkdtemp(join(tmpdir(), 'sparqly-sources-controller-'));
  const server = await createServer({
    sources: sources as Parameters<typeof createServer>[0]['sources'],
    port: 0,
    readOnly: options.readOnly,
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
