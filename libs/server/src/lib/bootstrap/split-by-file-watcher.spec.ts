import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SparqlyLogFields, SparqlyLogger } from 'common';
import { createServer, type CreatedServer } from './create-server';

const SAMPLE_A = '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n';
const SAMPLE_B = '@prefix ex: <http://example.org/> . ex:c ex:p ex:d .\n';
const SAMPLE_C = '@prefix ex: <http://example.org/> . ex:e ex:p ex:f .\n';

interface RecordedLog {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  fields?: SparqlyLogFields;
}

function recordingLogger(): {
  logger: SparqlyLogger;
  waitFor: (
    predicate: (entry: RecordedLog) => boolean,
    timeoutMs?: number,
  ) => Promise<RecordedLog>;
} {
  const entries: RecordedLog[] = [];
  const waiters: Array<{
    predicate: (entry: RecordedLog) => boolean;
    resolve: (entry: RecordedLog) => void;
  }> = [];
  const record =
    (level: RecordedLog['level']) =>
    (msg: string, fields?: SparqlyLogFields): void => {
      const entry: RecordedLog = { level, msg, fields };
      entries.push(entry);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].predicate(entry)) {
          waiters[i].resolve(entry);
          waiters.splice(i, 1);
        }
      }
    };
  return {
    logger: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    },
    waitFor: (predicate, timeoutMs = 5000) => {
      const existing = entries.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const idx = waiters.indexOf(waiter);
          if (idx >= 0) {
            waiters.splice(idx, 1);
            reject(
              new Error(`Timed out waiting for log entry after ${timeoutMs}ms`),
            );
          }
        }, timeoutMs);
      });
    },
  };
}

interface ConfigResponse {
  sources: Array<{
    id: string;
    kind: string;
    label: string;
    default?: boolean;
    parentId?: string;
  }>;
}

async function fetchSources(port: number): Promise<ConfigResponse['sources']> {
  const resp = await fetch(`http://localhost:${port}/api/config`);
  return ((await resp.json()) as ConfigResponse).sources;
}

describe('multi-source watcher — split-glob children cache invalidation (ADR-0027)', () => {
  let dir: string;
  let server: CreatedServer | undefined;

  beforeEach(async () => {
    Logger.overrideLogger(false);
    dir = await mkdtemp(join(tmpdir(), 'sparqly-split-watch-'));
    await writeFile(join(dir, 'a.ttl'), SAMPLE_A);
    await writeFile(join(dir, 'b.ttl'), SAMPLE_B);
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it('adds a new child to /api/config when a file appears inside a split-glob pattern', async () => {
    const { logger, waitFor } = recordingLogger();
    server = await createServer({
      sources: [
        { id: 'docs', glob: join(dir, '*.ttl'), splitByFile: true },
      ],
      port: 0,
      watch: true,
      watchDebounceMs: 25,
      logger,
    });

    const before = await fetchSources(server.port);
    expect(
      before
        .filter((s) => s.kind === 'file')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['docs/a.ttl', 'docs/b.ttl']);

    await writeFile(join(dir, 'c.ttl'), SAMPLE_C);

    await waitFor(
      (e) =>
        e.msg === 'split-children-invalidated' &&
        (e.fields as { parentId?: string } | undefined)?.parentId === 'docs',
    );

    const after = await fetchSources(server.port);
    expect(
      after
        .filter((s) => s.kind === 'file')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['docs/a.ttl', 'docs/b.ttl', 'docs/c.ttl']);
    const newChild = after.find((s) => s.id === 'docs/c.ttl');
    expect(newChild).toMatchObject({ kind: 'file', parentId: 'docs' });
  });

  it('removes a child from /api/config when a file disappears from a split-glob pattern', async () => {
    const { logger, waitFor } = recordingLogger();
    server = await createServer({
      sources: [
        { id: 'docs', glob: join(dir, '*.ttl'), splitByFile: true },
      ],
      port: 0,
      watch: true,
      watchDebounceMs: 25,
      logger,
    });

    await unlink(join(dir, 'b.ttl'));

    await waitFor(
      (e) =>
        e.msg === 'split-children-invalidated' &&
        (e.fields as { parentId?: string } | undefined)?.parentId === 'docs',
    );

    const after = await fetchSources(server.port);
    expect(
      after
        .filter((s) => s.kind === 'file')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['docs/a.ttl']);
  });

  it('does not synthesize file-kind children for non-splitByFile globs on file events', async () => {
    const { logger } = recordingLogger();
    server = await createServer({
      sources: [{ id: 'plain', glob: join(dir, '*.ttl') }],
      port: 0,
      watch: true,
      watchDebounceMs: 25,
      logger,
    });

    await writeFile(join(dir, 'c.ttl'), SAMPLE_C);
    // Give the watcher enough time to debounce + rebuild + (incorrectly) invalidate.
    await new Promise((r) => setTimeout(r, 200));

    const sources = await fetchSources(server.port);
    expect(sources.filter((s) => s.kind === 'file')).toEqual([]);
    expect(sources.map((s) => s.id)).toContain('plain');
  });
});
