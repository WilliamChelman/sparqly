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
