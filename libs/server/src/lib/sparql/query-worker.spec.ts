import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { err, ok, ResultAsync } from 'neverthrow';
import {
  parseSourceSpecs,
  QueryEngine,
  resolveSourceResult,
  unionDefaultGraphEnabled,
  type ExecuteResult,
} from 'core';
import {
  runQueryWorker,
  type ResidentStore,
  type StoreBuilder,
  type WorkerPort,
} from './query-worker';
import type {
  LoadRequest,
  QueryRequest,
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

describe('runQueryWorker — LRU residency (ADR-0050, #387)', () => {
  const resolveOptions: WorkerResolveOptions = {
    resolutionRegistry: [],
    configDir: '/tmp',
    sparqlyVersion: undefined,
    indexCacheDir: undefined,
  };

  function loadReq(sourceId: string): LoadRequest {
    const [source] = parseSourceSpecs([{ id: sourceId, glob: `/x/${sourceId}.ttl` }]);
    return { type: 'load', sourceId, source, resolveOptions };
  }

  function queryReq(requestId: number, sourceId: string): QueryRequest {
    return {
      type: 'query',
      requestId,
      sourceId,
      query: 'SELECT * WHERE { ?s ?p ?o }',
      format: 'json',
      mutable: false,
    };
  }

  function executeResult(body: string): ExecuteResult {
    return { body, format: 'json', contentType: 'application/sparql-results+json' };
  }

  function fakeStore(quads: number, body: string): ResidentStore {
    return {
      quads,
      files: [],
      engine: {
        execute: async () => executeResult(body),
        executeResult: () => ResultAsync.fromSafePromise(Promise.resolve(executeResult(body))),
      },
    };
  }

  /** A builder backed by fake stores; records how many times each source was
   * (re)built so a test can observe eviction → rebuild. */
  function countingBuilder(quadsPerSource = 2): {
    build: StoreBuilder;
    counts: Map<string, number>;
  } {
    const counts = new Map<string, number>();
    const build: StoreBuilder = async (request) => {
      counts.set(request.sourceId, (counts.get(request.sourceId) ?? 0) + 1);
      return ok(fakeStore(quadsPerSource, `body:${request.sourceId}`));
    };
    return { build, counts };
  }

  it('rebuilds an evicted store from its recipe on the next query (transparent re-touch)', async () => {
    const { build, counts } = countingBuilder(2);
    const port = new FakePort();
    runQueryWorker(port, { maxResidentQuads: 3, buildStore: build });

    port.send(loadReq('a'));
    await port.next();
    // Loading 'b' pushes the resident total to 4 > 3 → evicts idle LRU 'a'.
    port.send(loadReq('b'));
    await port.next();
    expect(counts.get('a')).toBe(1);

    // Query 'a' — its store was evicted, so the worker rebuilds from the recipe
    // and answers correctly without the main thread re-sending a load.
    port.send(queryReq(1, 'a'));
    const result = (await port.next()) as QueryResultMessage;
    expect(result.requestId).toBe(1);
    expect(result.ok?.body).toBe('body:a');
    expect(counts.get('a')).toBe(2);
  });

  it('never evicts a store while a query is in flight against it', async () => {
    const counts = new Map<string, number>();
    let releaseA!: () => void;
    const aGate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const build: StoreBuilder = async (request) => {
      counts.set(request.sourceId, (counts.get(request.sourceId) ?? 0) + 1);
      if (request.sourceId === 'a') {
        return ok({
          quads: 2,
          files: [],
          engine: {
            execute: async () => executeResult('a-result'),
            executeResult: () =>
              new ResultAsync(aGate.then(() => ok(executeResult('a-result')))),
          },
        });
      }
      return ok(fakeStore(2, `body:${request.sourceId}`));
    };
    const port = new FakePort();
    runQueryWorker(port, { maxResidentQuads: 3, buildStore: build });

    port.send(loadReq('a'));
    await port.next();
    // Start a query on 'a' — it pins 'a' and blocks on the gate.
    port.send(queryReq(1, 'a'));
    // Load 'b' while 'a' is pinned: the resident total hits 4 > 3, but 'a' (the
    // LRU) is pinned, so nothing is evicted.
    port.send(loadReq('b'));
    await port.next();

    // Release the in-flight query — it still resolves against the live store.
    releaseA();
    const result = (await port.next()) as QueryResultMessage;
    expect(result.requestId).toBe(1);
    expect(result.ok?.body).toBe('a-result');
    // 'a' was never evicted, so it was never rebuilt.
    expect(counts.get('a')).toBe(1);
  });

  it('cancels an in-flight query on a cancel message, surfacing a typed error and keeping the store resident', async () => {
    let buildCount = 0;
    // An engine that hangs until either its signal aborts (→ typed error) or a
    // 50ms fallback fires (→ ok). The cancel message must beat the fallback.
    const build: StoreBuilder = async () => {
      buildCount++;
      return ok({
        quads: 2,
        files: [],
        engine: {
          execute: async () => executeResult('late-ok'),
          executeResult: (query, options) =>
            new ResultAsync(
              new Promise((resolve) => {
                const cancelled = err({
                  kind: 'query-execution' as const,
                  query,
                  message: 'query cancelled',
                });
                // Match QueryEngine's contract: an already-aborted signal yields
                // a typed error without running the query.
                if (options?.signal?.aborted) {
                  resolve(cancelled);
                  return;
                }
                const timer = setTimeout(
                  () => resolve(ok(executeResult('late-ok'))),
                  50,
                );
                options?.signal?.addEventListener(
                  'abort',
                  () => {
                    clearTimeout(timer);
                    resolve(cancelled);
                  },
                  { once: true },
                );
              }),
            ),
        },
      });
    };
    const port = new FakePort();
    runQueryWorker(port, { buildStore: build });

    port.send(loadReq('a'));
    await port.next();

    // Start a query that hangs, then cancel it before the fallback resolves.
    port.send(queryReq(1, 'a'));
    port.send({ type: 'cancel', requestId: 1 });

    const cancelled = (await port.next()) as QueryResultMessage;
    expect(cancelled.requestId).toBe(1);
    expect(cancelled.error?.kind).toBe('query-execution');

    // The store survives the cancel: a follow-up query is answered with no
    // rebuild (the source was never evicted or dropped).
    port.send(queryReq(2, 'a'));
    const after = (await port.next()) as QueryResultMessage;
    expect(after.requestId).toBe(2);
    expect(after.ok?.body).toBe('late-ok');
    expect(buildCount).toBe(1);
  });

  it('drops a resident store on invalidate and rebuilds it from the recipe on the next query', async () => {
    const { build, counts } = countingBuilder(2);
    const port = new FakePort();
    // High default budget — the drop is the invalidate, never an eviction.
    runQueryWorker(port, { buildStore: build });

    port.send(loadReq('a'));
    await port.next();
    expect(counts.get('a')).toBe(1);

    // Invalidate (e.g. a `--watch` edit or Reload reached the owning worker):
    // the resident store is dropped, but the recipe is retained.
    port.send({ type: 'invalidate', sourceId: 'a' });

    // The next query finds no resident store and rebuilds from the recipe,
    // transparently, without the main thread re-sending a load.
    port.send(queryReq(1, 'a'));
    const result = (await port.next()) as QueryResultMessage;
    expect(result.requestId).toBe(1);
    expect(result.ok?.body).toBe('body:a');
    expect(counts.get('a')).toBe(2);
  });

  it('ignores an invalidate for a source it has never loaded', async () => {
    const { build, counts } = countingBuilder(2);
    const port = new FakePort();
    runQueryWorker(port, { buildStore: build });

    // No recipe and nothing resident — a stray invalidate is a harmless no-op.
    port.send({ type: 'invalidate', sourceId: 'ghost' });

    port.send(loadReq('a'));
    await port.next();
    expect(counts.get('a')).toBe(1);
  });

  it('never evicts a small registry under the default budget (no behavior change)', async () => {
    const { build, counts } = countingBuilder(2);
    const port = new FakePort();
    // No maxResidentQuads → the high default budget applies.
    runQueryWorker(port, { buildStore: build });

    for (const id of ['a', 'b', 'c']) {
      port.send(loadReq(id));
      await port.next();
    }

    // The first-touched source is still resident: querying it answers without
    // a rebuild (its build count stays 1).
    port.send(queryReq(1, 'a'));
    const result = (await port.next()) as QueryResultMessage;
    expect(result.ok?.body).toBe('body:a');
    expect(counts.get('a')).toBe(1);
  });
});
