import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSourceSpecs } from 'core';
import { EngineMap } from './engine-map';
import { QueryWorkerPool } from '../sparql/query-worker-pool';
import type {
  QueryWorkerHandle,
  WorkerMessage,
  WorkerRequest,
} from '../sparql/query-worker-protocol';
import { SourceStateEmitter } from '../sources/source-state-emitter';
import type { SourceTransition } from '../sources/source-state-event';

type Responder = (
  request: WorkerRequest,
  reply: (message: WorkerMessage) => void,
) => void;

/** In-process worker stand-in — the EngineMap never spawns a real thread; the
 * fake scripts how the "worker" answers load/query so routing + the state
 * mirror are exercised deterministically. */
class FakeWorker implements QueryWorkerHandle {
  private readonly listeners: Array<(m: WorkerMessage) => void> = [];
  readonly sent: WorkerRequest[] = [];

  constructor(private readonly respond: Responder) {}

  postMessage(message: WorkerRequest): void {
    this.sent.push(message);
    queueMicrotask(() => this.respond(message, (m) => this.emit(m)));
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

const QUERY_OK = {
  body: '{"head":{"vars":["s"]},"results":{"bindings":[]}}',
  format: 'json' as const,
  contentType: 'application/sparql-results+json',
};

function loadingWorker(overrides: Partial<{ quads: number; loadMs: number; files: string[] }> = {}): FakeWorker {
  return new FakeWorker((request, reply) => {
    if (request.type === 'load') {
      reply({
        type: 'load-success',
        sourceId: request.sourceId,
        quads: overrides.quads ?? 5,
        loadMs: overrides.loadMs ?? 3,
        files: overrides.files ?? ['a.ttl'],
      });
    } else {
      reply({ type: 'query-result', requestId: request.requestId, ok: QUERY_OK });
    }
  });
}

describe('EngineMap — worker routing (ADR-0050)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-engine-map-worker-'));
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('routes an in-memory query through the worker and mirrors loaded state', async () => {
    const registry = parseSourceSpecs([{ id: 'alpha', glob: join(dir, '*.ttl') }]);
    const worker = loadingWorker({ quads: 5, loadMs: 3, files: ['a.ttl'] });
    const pool = new QueryWorkerPool({ spawn: () => worker });
    const emitter = new SourceStateEmitter();
    const events: SourceTransition[] = [];
    emitter.subscribe((e) => events.push(e));

    const map = await EngineMap.create(registry, {
      queryPool: pool,
      sourceStateEmitter: emitter,
    });
    try {
      // Pure observer reads not-loaded before first touch.
      expect(await map.readState('alpha')).toEqual({
        mode: 'in-memory',
        state: 'not-loaded',
      });

      const executor = (await map.ensure('alpha'))._unsafeUnwrap();
      const result = (
        await executor.executeResult('SELECT ?s WHERE { ?s ?p ?o }', {
          format: 'json',
        })
      )._unsafeUnwrap();
      expect(result).toEqual(QUERY_OK);

      // The worker built the store (load) then ran the query — the main loop did neither.
      expect(worker.sent.map((m) => m.type)).toEqual(['load', 'query']);

      // The state mirror reports `loaded` with the worker's metrics.
      const state = await map.readState('alpha');
      expect(state).toEqual({
        mode: 'in-memory',
        state: 'loaded',
        metrics: {
          files: 1,
          loadedAt: expect.any(Number),
          loadMs: 3,
          quads: 5,
        },
      });

      // Worker lifecycle drove the SSE source-state stream.
      expect(events.map((e) => e.kind)).toEqual(['load-start', 'load-success']);
    } finally {
      await map.close();
    }
  });

  it('rebuilds a worker-owned store on the next touch after the worker is reclaimed mid-cancel', async () => {
    const registry = parseSourceSpecs([{ id: 'alpha', glob: join(dir, '*.ttl') }]);
    const workers: FakeWorker[] = [];
    // Worker 0 loads fine but is "stuck": it answers neither query nor cancel.
    // The respawn (index > 0) answers both, so the rebuilt store is queryable.
    const spawn = (): FakeWorker => {
      const index = workers.length;
      const worker = new FakeWorker((request, reply) => {
        if (request.type === 'load') {
          reply({
            type: 'load-success',
            sourceId: request.sourceId,
            quads: 5,
            loadMs: 3,
            files: ['a.ttl'],
          });
        } else if (request.type === 'query' && index > 0) {
          reply({ type: 'query-result', requestId: request.requestId, ok: QUERY_OK });
        }
      });
      workers.push(worker);
      return worker;
    };
    const pool = new QueryWorkerPool({ spawn, concurrency: 1, cancelGraceMs: 10 });

    const map = await EngineMap.create(registry, { queryPool: pool });
    try {
      const executor = (await map.ensure('alpha'))._unsafeUnwrap();
      expect(workers).toHaveLength(1);
      expect(workers[0].sent.filter((m) => m.type === 'load')).toHaveLength(1);

      // Abort an in-flight query against the stuck worker → nuclear reclaim.
      const controller = new AbortController();
      const inflight = executor.executeResult('SELECT ?s WHERE { ?s ?p ?o }', {
        format: 'json',
        signal: controller.signal,
      });
      controller.abort();
      expect((await inflight).isErr()).toBe(true);
      expect(workers).toHaveLength(2); // respawned

      // Next touch re-loads on the fresh worker and answers the query.
      const reloaded = (await map.ensure('alpha'))._unsafeUnwrap();
      const result = (
        await reloaded.executeResult('SELECT ?s WHERE { ?s ?p ?o }', {
          format: 'json',
        })
      )._unsafeUnwrap();
      expect(result).toEqual(QUERY_OK);
      // The replacement worker rebuilt the store from a fresh load.
      expect(workers[1].sent.filter((m) => m.type === 'load')).toHaveLength(1);
    } finally {
      await map.close();
    }
  });

  it('surfaces a worker load failure as a typed SourceError and mirrors failed state', async () => {
    const registry = parseSourceSpecs([{ id: 'alpha', glob: join(dir, '*.ttl') }]);
    const worker = new FakeWorker((request, reply) => {
      if (request.type === 'load') {
        reply({
          type: 'load-failure',
          sourceId: request.sourceId,
          error: { kind: 'glob-load', glob: [join(dir, '*.ttl')], message: 'parse blew up' },
        });
      }
    });
    const pool = new QueryWorkerPool({ spawn: () => worker });
    const emitter = new SourceStateEmitter();
    const events: SourceTransition[] = [];
    emitter.subscribe((e) => events.push(e));

    const map = await EngineMap.create(registry, {
      queryPool: pool,
      sourceStateEmitter: emitter,
    });
    try {
      const result = await map.ensure('alpha');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().kind).toBe('glob-load');

      const state = await map.readState('alpha');
      expect(state.mode).toBe('in-memory');
      if (state.mode === 'in-memory') {
        expect(state.state).toBe('failed');
        expect(state.error?.kind).toBe('glob-load');
      }
      expect(events.map((e) => e.kind)).toEqual(['load-start', 'load-failure']);
    } finally {
      await map.close();
    }
  });

  it('does not route endpoint sources through the worker', async () => {
    const registry = parseSourceSpecs([
      { id: 'remote', endpoint: 'http://127.0.0.1:1/sparql' },
    ]);
    const worker = loadingWorker();
    const pool = new QueryWorkerPool({ spawn: () => worker });

    const map = await EngineMap.create(registry, { queryPool: pool });
    try {
      await map.ensure('remote');
      expect(worker.sent).toEqual([]);
      expect(await map.readState('remote')).toEqual({ mode: 'endpoint' });
    } finally {
      await map.close();
    }
  });

  it('Reload returns the entry to loaded; Unload returns it to not-loaded', async () => {
    const registry = parseSourceSpecs([{ id: 'alpha', glob: join(dir, '*.ttl') }]);
    const worker = loadingWorker();
    const pool = new QueryWorkerPool({ spawn: () => worker });
    const emitter = new SourceStateEmitter();
    const events: SourceTransition[] = [];
    emitter.subscribe((e) => events.push(e));

    const map = await EngineMap.create(registry, {
      queryPool: pool,
      sourceStateEmitter: emitter,
    });
    try {
      await map.ensure('alpha');
      expect((await map.readState('alpha')).state).toBe('loaded');

      await map.reload('alpha');
      expect((await map.readState('alpha')).state).toBe('loaded');

      await map.unload('alpha');
      expect(await map.readState('alpha')).toEqual({
        mode: 'in-memory',
        state: 'not-loaded',
      });
      expect(events.map((e) => e.kind)).toContain('unload');
    } finally {
      await map.close();
    }
  });
});
