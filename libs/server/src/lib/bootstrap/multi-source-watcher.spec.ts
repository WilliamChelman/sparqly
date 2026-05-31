import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SparqlyLogFields, SparqlyLogger } from 'common';
import { createTestServer, type CreatedServer } from './create-test-server';
import type {
  QueryWorkerHandle,
  WorkerMessage,
  WorkerRequest,
} from '../sparql/query-worker-protocol';

interface RecordedLog {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  fields?: SparqlyLogFields;
}

function recordingLogger(): {
  logger: SparqlyLogger;
  entries: RecordedLog[];
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
    entries,
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
            reject(new Error(`Timed out waiting for log entry after ${timeoutMs}ms`));
          }
        }, timeoutMs);
      });
    },
  };
}

const EMPTY_RESULT_BODY = JSON.stringify({
  head: { vars: ['s'] },
  results: { bindings: [] },
});

/** In-process query-worker stand-in (ADR-0050) — answers load/query so a source
 * routes through the pool and becomes `loaded`, and records every request so a
 * test can assert the watcher reached it with an `invalidate`. No real thread,
 * no real store. */
class FakeQueryWorker implements QueryWorkerHandle {
  private readonly listeners: Array<(m: WorkerMessage) => void> = [];
  readonly sent: WorkerRequest[] = [];

  postMessage(message: WorkerRequest): void {
    this.sent.push(message);
    queueMicrotask(() => {
      if (message.type === 'load') {
        this.emit({
          type: 'load-success',
          sourceId: message.sourceId,
          quads: 1,
          loadMs: 1,
          files: [],
        });
      } else if (message.type === 'query') {
        this.emit({
          type: 'query-result',
          requestId: message.requestId,
          ok: {
            body: EMPTY_RESULT_BODY,
            format: 'json',
            contentType: 'application/sparql-results+json',
          },
        });
      }
    });
  }

  on(event: 'message', listener: (m: WorkerMessage) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  on(event: string, listener: (...args: never[]) => void): void {
    if (event === 'message') this.listeners.push(listener as (m: WorkerMessage) => void);
  }

  async terminate(): Promise<number> {
    return 0;
  }

  private emit(message: WorkerMessage): void {
    for (const l of this.listeners) l(message);
  }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function bindings(url: string): Promise<string[]> {
  const resp = await fetch(
    `${url}?query=${encodeURIComponent('SELECT ?s WHERE { ?s ?p ?o }')}`,
  );
  const json = (await resp.json()) as {
    results: { bindings: Array<{ s: { value: string } }> };
  };
  return json.results.bindings.map((b) => b.s.value).sort();
}

describe('createServer — multi-source watcher lifecycle', () => {
  let dir: string;
  let server: CreatedServer | undefined;

  beforeEach(async () => {
    Logger.overrideLogger(false);
    dir = await mkdtemp(join(tmpdir(), 'sparqly-watch-lifecycle-'));
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:initial .',
    );
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it('FS events for a path under a never-touched source do not trigger a load (ADR-0031)', async () => {
    // Two materialized sources. Only `touched` is queried; `untouched` stays
    // un-ensure()'d for the life of the test. Mutating a file under
    // `untouched`'s glob must not cause a `source-loaded` boundary log line
    // for it — the watcher must respect the lazy-materialization contract.
    const touchedDir = await mkdtemp(
      join(tmpdir(), 'sparqly-watch-lazy-touched-'),
    );
    const untouchedDir = await mkdtemp(
      join(tmpdir(), 'sparqly-watch-lazy-untouched-'),
    );
    try {
      await writeFile(
        join(touchedDir, 'a.ttl'),
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
      );
      await writeFile(
        join(untouchedDir, 'a.ttl'),
        '@prefix ex: <http://example.org/> . ex:c ex:p ex:d .',
      );
      const rec = recordingLogger();
      server = await createTestServer({
        sources: [
          { id: 'touched', glob: join(touchedDir, '*.ttl') },
          { id: 'untouched', glob: join(untouchedDir, '*.ttl') },
        ],
        port: 0,
        watch: true,
        watchDebounceMs: 25,
        logger: rec.logger,
      });

      // Warm `touched` only so it has a live storeRef; `untouched` remains
      // un-loaded for the rest of the test.
      expect(
        await bindings(
          `http://localhost:${server.port}/api/sparql/touched`,
        ),
      ).toEqual(['http://example.org/a']);
      await rec.waitFor(
        (e) =>
          e.msg === 'source-loaded' &&
          (e.fields as { source?: string } | undefined)?.source === 'touched',
      );

      // Bump a file under the un-touched source's glob and wait long enough
      // for the watcher to have processed (and skipped) the event.
      await writeFile(
        join(untouchedDir, 'b.ttl'),
        '@prefix ex: <http://example.org/> . ex:e ex:p ex:f .',
      );
      // Sleep > watchDebounceMs + chokidar settling, then assert no rebuild
      // happened for the un-touched source.
      await new Promise((r) => setTimeout(r, 300));

      const loadedUntouched = rec.entries.filter(
        (e) =>
          e.msg === 'source-loaded' &&
          (e.fields as { source?: string } | undefined)?.source === 'untouched',
      );
      expect(loadedUntouched).toEqual([]);
      const rebuiltUntouched = rec.entries.filter(
        (e) =>
          e.msg === 'source-rebuilt' &&
          (e.fields as { source?: string } | undefined)?.source === 'untouched',
      );
      expect(rebuiltUntouched).toEqual([]);
    } finally {
      await rm(touchedDir, { recursive: true, force: true });
      await rm(untouchedDir, { recursive: true, force: true });
    }
  });

  it('starts the watcher, debounces a file change into a single rebuild, then stops cleanly on close', async () => {
    const { logger, entries, waitFor } = recordingLogger();
    server = await createTestServer({
      sources: [{ id: 'files', glob: join(dir, '*.ttl') }],
      port: 0,
      watch: true,
      watchDebounceMs: 25,
      logger,
    });
    const sparqlUrl = `http://localhost:${server.port}/api/sparql/files`;
    expect(await bindings(sparqlUrl)).toEqual(['http://example.org/a']);

    await writeFile(
      join(dir, 'b.ttl'),
      '@prefix ex: <http://example.org/> . ex:b ex:p ex:added .',
    );
    await writeFile(
      join(dir, 'c.ttl'),
      '@prefix ex: <http://example.org/> . ex:c ex:p ex:added .',
    );

    const rebuilt = await waitFor(
      (e) =>
        e.msg === 'source-rebuilt' &&
        (e.fields as { source?: string } | undefined)?.source === 'files',
    );
    expect(rebuilt.fields?.['files']).toBe(3);

    expect(await bindings(sparqlUrl)).toEqual([
      'http://example.org/a',
      'http://example.org/b',
      'http://example.org/c',
    ]);

    const rebuildsBeforeClose = entries.filter(
      (e) => e.msg === 'source-rebuilt',
    ).length;
    expect(rebuildsBeforeClose).toBe(1);

    await server.close();
    server = undefined;

    await writeFile(
      join(dir, 'd.ttl'),
      '@prefix ex: <http://example.org/> . ex:d ex:p ex:later .',
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(
      entries.filter((e) => e.msg === 'source-rebuilt').length,
    ).toBe(rebuildsBeforeClose);
  });
});

describe('createServer — watcher invalidation reaches the query worker (ADR-0050, #391)', () => {
  let touchedDir: string;
  let untouchedDir: string;
  let server: CreatedServer | undefined;

  beforeEach(async () => {
    Logger.overrideLogger(false);
    touchedDir = await mkdtemp(join(tmpdir(), 'sparqly-watch-worker-touched-'));
    untouchedDir = await mkdtemp(
      join(tmpdir(), 'sparqly-watch-worker-untouched-'),
    );
    await writeFile(
      join(touchedDir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:initial .',
    );
    await writeFile(
      join(untouchedDir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:c ex:p ex:d .',
    );
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
    await rm(touchedDir, { recursive: true, force: true });
    await rm(untouchedDir, { recursive: true, force: true });
  });

  it('a watched file change posts invalidate to the owning worker, and leaves an un-touched source alone', async () => {
    const worker = new FakeQueryWorker();
    server = await createTestServer({
      sources: [
        { id: 'touched', glob: join(touchedDir, '*.ttl') },
        { id: 'untouched', glob: join(untouchedDir, '*.ttl') },
      ],
      port: 0,
      watch: true,
      watchDebounceMs: 25,
      spawnQueryWorker: () => worker,
    });

    // Warm `touched` so its store is resident on the worker; `untouched` stays
    // un-queried for the life of the test.
    await bindings(`http://localhost:${server.port}/api/sparql/touched`);
    await waitFor(() => worker.sent.some((m) => m.type === 'query'));

    // Edit a watched file under the loaded source.
    await writeFile(
      join(touchedDir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:edited .',
    );

    // The watcher reaches the owning worker with an invalidate so the next
    // query rebuilds the resident store from disk.
    await waitFor(() =>
      worker.sent.some(
        (m) => m.type === 'invalidate' && m.sourceId === 'touched',
      ),
    );

    // Edit a file under the never-queried source and give the watcher time to
    // process it: laziness holds — no invalidate is posted for it (nothing is
    // resident to drop).
    await writeFile(
      join(untouchedDir, 'b.ttl'),
      '@prefix ex: <http://example.org/> . ex:e ex:p ex:f .',
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(
      worker.sent.some(
        (m) => m.type === 'invalidate' && m.sourceId === 'untouched',
      ),
    ).toBe(false);
  });
});
