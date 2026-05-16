import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SparqlyLogFields, SparqlyLogger } from 'common';
import { createServer, type CreatedServer } from './create-server';

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
      server = await createServer({
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
          e.msg === 'view-rebuilt' &&
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
    server = await createServer({
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
        e.msg === 'view-rebuilt' &&
        (e.fields as { source?: string } | undefined)?.source === 'files',
    );
    expect(rebuilt.fields?.['files']).toBe(3);

    expect(await bindings(sparqlUrl)).toEqual([
      'http://example.org/a',
      'http://example.org/b',
      'http://example.org/c',
    ]);

    const rebuildsBeforeClose = entries.filter(
      (e) => e.msg === 'view-rebuilt',
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
      entries.filter((e) => e.msg === 'view-rebuilt').length,
    ).toBe(rebuildsBeforeClose);
  });
});
