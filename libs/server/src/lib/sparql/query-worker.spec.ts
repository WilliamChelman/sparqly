import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseSourceSpecs,
  QueryEngine,
  resolveSourceResult,
  unionDefaultGraphEnabled,
} from 'core';
import { runQueryWorker, type WorkerPort } from './query-worker';
import type {
  QueryResultMessage,
  WorkerMessage,
  WorkerRequest,
  WorkerResolveOptions,
} from './query-worker-protocol';

/** Drives {@link runQueryWorker} without a real thread: feeds it requests and
 * lets a test await the next reply. */
class FakePort implements WorkerPort {
  private handler: ((m: WorkerRequest) => void) | undefined;
  private readonly outbox: WorkerMessage[] = [];
  private readonly waiters: Array<(m: WorkerMessage) => void> = [];

  postMessage(message: WorkerMessage): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(message);
    else this.outbox.push(message);
  }

  on(_event: 'message', listener: (m: WorkerRequest) => void): void {
    this.handler = listener;
  }

  send(request: WorkerRequest): void {
    this.handler?.(request);
  }

  next(): Promise<WorkerMessage> {
    const queued = this.outbox.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

const TTL = '@prefix ex: <http://example.org/> . ex:a ex:p ex:b . ex:c ex:p ex:d .';

describe('runQueryWorker', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-query-worker-'));
    await writeFile(join(dir, 'data.ttl'), TTL);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function resolveOptionsFor(registry: ReturnType<typeof parseSourceSpecs>): WorkerResolveOptions {
    return {
      resolutionRegistry: registry,
      configDir: dir,
      sparqlyVersion: undefined,
      indexCacheDir: undefined,
    };
  }

  it('builds the store and answers a query byte-identically to the in-process engine', async () => {
    const registry = parseSourceSpecs([{ id: 'alpha', glob: join(dir, '*.ttl') }]);
    const source = registry[0];
    const port = new FakePort();
    runQueryWorker(port);

    port.send({
      type: 'load',
      sourceId: 'alpha',
      source,
      resolveOptions: resolveOptionsFor(registry),
    });
    const load = await port.next();
    expect(load.type).toBe('load-success');
    if (load.type === 'load-success') {
      expect(load.quads).toBe(2);
      expect(load.files).toEqual([join(dir, 'data.ttl')]);
    }

    port.send({
      type: 'query',
      requestId: 7,
      sourceId: 'alpha',
      query: 'SELECT ?s WHERE { ?s ?p ?o } ORDER BY ?s',
      format: 'json',
      mutable: false,
    });
    const result = (await port.next()) as QueryResultMessage;
    expect(result.requestId).toBe(7);
    expect(result.ok).toBeDefined();

    // The worker's body must match the legacy main-thread path exactly.
    const sources = (
      await resolveSourceResult(source, { registry, configDir: dir })
    )._unsafeUnwrap();
    if (sources.mode !== 'materialized') throw new Error('expected materialized');
    const expected = await new QueryEngine(
      sources.store,
      { id: 'alpha', mode: 'materialized' },
      { unionDefaultGraph: unionDefaultGraphEnabled(source) },
    ).execute('SELECT ?s WHERE { ?s ?p ?o } ORDER BY ?s', { format: 'json' });
    expect(result.ok?.body).toBe(expected.body);
  });

  it('replies load-failure with a typed SourceError when the store cannot build', async () => {
    const registry = parseSourceSpecs([
      { id: 'broken', glob: join(dir, 'data.ttl') },
    ]);
    await writeFile(join(dir, 'data.ttl'), 'this is not valid turtle <<<');
    const source = registry[0];
    const port = new FakePort();
    runQueryWorker(port);

    port.send({
      type: 'load',
      sourceId: 'broken',
      source,
      resolveOptions: resolveOptionsFor(registry),
    });
    const load = await port.next();
    expect(load.type).toBe('load-failure');
    if (load.type === 'load-failure') {
      expect(typeof load.error.kind).toBe('string');
    }
  });
});
