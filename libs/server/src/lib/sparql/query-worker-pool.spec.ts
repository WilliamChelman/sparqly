import { describe, expect, it } from 'vitest';
import type { ExecuteResult, ParsedSource } from 'core';
import {
  HashStickyAssignment,
  QueryWorkerPool,
  type AssignmentStrategy,
} from './query-worker-pool';
import type {
  QueryWorkerHandle,
  WorkerMessage,
  WorkerRequest,
  WorkerResolveOptions,
} from './query-worker-protocol';

const ALPHA: ParsedSource = {
  kind: 'glob',
  id: 'alpha',
  glob: '/tmp/alpha/*.ttl',
} as ParsedSource;

const RESOLVE_OPTS: WorkerResolveOptions = {
  resolutionRegistry: [],
  configDir: '/tmp',
  sparqlyVersion: undefined,
  indexCacheDir: undefined,
};

/**
 * In-process stand-in for the real `worker_threads.Worker` — exposes the
 * {@link QueryWorkerHandle} surface the pool drives and lets a test script how
 * the "worker" replies to each request, so the pool's dispatch/correlation is
 * exercised without spawning a real thread.
 */
class FakeWorker implements QueryWorkerHandle {
  private readonly messageListeners: Array<(m: WorkerMessage) => void> = [];
  readonly sent: WorkerRequest[] = [];

  constructor(
    private readonly respond: (
      request: WorkerRequest,
      reply: (message: WorkerMessage) => void,
    ) => void,
  ) {}

  postMessage(message: WorkerRequest): void {
    this.sent.push(message);
    // Async hop so the pool registers its pending handler before the reply.
    queueMicrotask(() => this.respond(message, (m) => this.emit(m)));
  }

  on(event: 'message', listener: (m: WorkerMessage) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  on(event: string, listener: (...args: never[]) => void): void {
    if (event === 'message') {
      this.messageListeners.push(listener as (m: WorkerMessage) => void);
    }
  }

  async terminate(): Promise<number> {
    return 0;
  }

  private emit(message: WorkerMessage): void {
    for (const listener of this.messageListeners) listener(message);
  }
}

/** Spawn factory that records every worker it hands out, so a test can assert
 * which worker a source's load/query was routed to. Each call yields a fresh
 * {@link FakeWorker} wired to `respond`. */
function recordingSpawn(
  respond: (
    request: WorkerRequest,
    reply: (message: WorkerMessage) => void,
  ) => void,
): { spawn: () => FakeWorker; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  return {
    workers,
    spawn: () => {
      const worker = new FakeWorker(respond);
      workers.push(worker);
      return worker;
    },
  };
}

const echoQuery = (
  request: WorkerRequest,
  reply: (message: WorkerMessage) => void,
): void => {
  if (request.type === 'query') {
    reply({
      type: 'query-result',
      requestId: request.requestId,
      ok: { body: `body-for:${request.query}`, format: 'json', contentType: 'x' },
    });
  }
};

describe('QueryWorkerPool — hash-sticky assignment', () => {
  it('routes each source to the worker its strategy assigns', async () => {
    const { spawn, workers } = recordingSpawn(echoQuery);
    const assignment: AssignmentStrategy = {
      assign: (sourceId) => (sourceId === 'alpha' ? 0 : 1),
    };
    const pool = new QueryWorkerPool({ spawn, concurrency: 2, assignment });

    await pool.query('alpha', 'Qa', {});
    await pool.query('beta', 'Qb', {});

    expect(workers).toHaveLength(2);
    expect(workers[0].sent).toContainEqual(
      expect.objectContaining({ type: 'query', sourceId: 'alpha', query: 'Qa' }),
    );
    expect(workers[1].sent).toContainEqual(
      expect.objectContaining({ type: 'query', sourceId: 'beta', query: 'Qb' }),
    );
    await pool.shutdown();
  });

  it('does not let a slow query on one source delay a query on another worker', async () => {
    // worker 0 (source A) never replies; worker 1 (source B) replies at once.
    // If the pool serialized across workers, B would hang behind A forever.
    const { spawn } = recordingSpawn((request, reply) => {
      if (request.type !== 'query') return;
      if (request.sourceId === 'B') {
        reply({
          type: 'query-result',
          requestId: request.requestId,
          ok: { body: 'B-result', format: 'json', contentType: 'x' },
        });
      }
      // 'A' is deliberately left unanswered — its worker is "stuck".
    });
    const assignment: AssignmentStrategy = {
      assign: (sourceId) => (sourceId === 'A' ? 0 : 1),
    };
    const pool = new QueryWorkerPool({ spawn, concurrency: 2, assignment });

    const slowA = pool.query('A', 'Qa', {});
    const fastB = pool.query('B', 'Qb', {});

    // B settles independently of A; A stays pending (raced against a timer).
    const pending = Symbol('pending');
    const aSettledFirst = Promise.race([
      slowA.then(() => 'A'),
      new Promise((r) => setTimeout(() => r(pending), 20)),
    ]);

    const b = await fastB;
    expect(b._unsafeUnwrap().body).toBe('B-result');
    expect(await aSettledFirst).toBe(pending);
    await pool.shutdown();
  });

  it('keeps a source on one worker across load and repeated queries (built once)', async () => {
    const { spawn, workers } = recordingSpawn((request, reply) => {
      if (request.type === 'load') {
        reply({
          type: 'load-success',
          sourceId: request.sourceId,
          quads: 1,
          loadMs: 1,
          files: ['a.ttl'],
        });
      } else {
        reply({
          type: 'query-result',
          requestId: request.requestId,
          ok: { body: 'r', format: 'json', contentType: 'x' },
        });
      }
    });
    const pool = new QueryWorkerPool({
      spawn,
      concurrency: 4,
      assignment: { assign: () => 2 },
    });

    await pool.ensureLoaded(ALPHA, RESOLVE_OPTS);
    await pool.query('alpha', 'Q1', {});
    await pool.query('alpha', 'Q2', {});

    // One worker spawned; it received the load and both queries — no rebuild
    // on a second worker.
    expect(workers).toHaveLength(1);
    expect(workers[0].sent.filter((m) => m.type === 'load')).toHaveLength(1);
    expect(workers[0].sent.filter((m) => m.type === 'query')).toHaveLength(2);
    await pool.shutdown();
  });

  it('co-locates sources that hash to the same worker (they share one thread)', async () => {
    // Two distinct sources both assigned to index 1 — documented expected
    // behavior: they share a worker and therefore serialize. Isolation is
    // cross-worker only (ADR-0050, isolation-not-throughput).
    const { spawn, workers } = recordingSpawn(echoQuery);
    const pool = new QueryWorkerPool({
      spawn,
      concurrency: 2,
      assignment: { assign: () => 1 },
    });

    await pool.query('x', 'Qx', {});
    await pool.query('y', 'Qy', {});

    expect(workers).toHaveLength(1);
    expect(workers[0].sent.map((m) => m.type === 'query' && m.sourceId)).toEqual([
      'x',
      'y',
    ]);
    await pool.shutdown();
  });
});

describe('HashStickyAssignment — default policy', () => {
  it('always returns the same in-range index for a given source', () => {
    const strategy = new HashStickyAssignment(4);
    const first = strategy.assign('people');
    expect(first).toBe(strategy.assign('people'));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(4);
  });

  it('spreads distinct sources across the available workers', () => {
    const strategy = new HashStickyAssignment(3);
    const indices = new Set(
      ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'].map((id) =>
        strategy.assign(id),
      ),
    );
    // Not a guarantee for any input, but FNV-1a over these ids touches >1 worker.
    expect(indices.size).toBeGreaterThan(1);
  });
});

describe('QueryWorkerPool — query dispatch', () => {
  it('returns the worker result byte-for-byte', async () => {
    const expected: ExecuteResult = {
      body: '{"head":{"vars":["s"]},"results":{"bindings":[]}}',
      format: 'json',
      contentType: 'application/sparql-results+json',
    };
    const worker = new FakeWorker((request, reply) => {
      if (request.type === 'query') {
        reply({ type: 'query-result', requestId: request.requestId, ok: expected });
      }
    });
    const pool = new QueryWorkerPool({ spawn: () => worker });

    const result = await pool.query('alpha', 'SELECT ?s WHERE { ?s ?p ?o }', {
      format: 'json',
      mutable: false,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(expected);
    await pool.shutdown();
  });

  it('correlates concurrent queries to their own results by requestId', async () => {
    const worker = new FakeWorker((request, reply) => {
      if (request.type !== 'query') return;
      // Reply out of order to prove correlation isn't positional.
      const body = `body-for:${request.query}`;
      const delay = request.query === 'A' ? 5 : 0;
      setTimeout(
        () =>
          reply({
            type: 'query-result',
            requestId: request.requestId,
            ok: { body, format: 'json', contentType: 'x' },
          }),
        delay,
      );
    });
    const pool = new QueryWorkerPool({ spawn: () => worker });

    const [a, b] = await Promise.all([
      pool.query('s', 'A', {}),
      pool.query('s', 'B', {}),
    ]);

    expect(a._unsafeUnwrap().body).toBe('body-for:A');
    expect(b._unsafeUnwrap().body).toBe('body-for:B');
    await pool.shutdown();
  });
});

describe('QueryWorkerPool — load lifecycle', () => {
  it('resolves ensureLoaded with the build metrics on load-success', async () => {
    const worker = new FakeWorker((request, reply) => {
      if (request.type === 'load') {
        reply({
          type: 'load-success',
          sourceId: request.sourceId,
          quads: 42,
          loadMs: 7,
          files: ['a.ttl', 'b.ttl', 'c.ttl'],
        });
      }
    });
    const pool = new QueryWorkerPool({ spawn: () => worker });

    const result = await pool.ensureLoaded(ALPHA, RESOLVE_OPTS);

    expect(result._unsafeUnwrap()).toEqual({ quads: 42, loadMs: 7, files: ['a.ttl', 'b.ttl', 'c.ttl'] });
    await pool.shutdown();
  });

  it('forwards the build source spec and resolve options to the worker', async () => {
    const worker = new FakeWorker((request, reply) => {
      if (request.type === 'load') {
        reply({
          type: 'load-success',
          sourceId: request.sourceId,
          quads: 0,
          loadMs: 0,
          files: [],
        });
      }
    });
    const pool = new QueryWorkerPool({ spawn: () => worker });

    await pool.ensureLoaded(ALPHA, RESOLVE_OPTS);

    const load = worker.sent.find((m) => m.type === 'load');
    expect(load).toEqual({
      type: 'load',
      sourceId: 'alpha',
      source: ALPHA,
      resolveOptions: RESOLVE_OPTS,
    });
    await pool.shutdown();
  });

  it('rejects ensureLoaded with the typed SourceError on load-failure', async () => {
    const worker = new FakeWorker((request, reply) => {
      if (request.type === 'load') {
        reply({
          type: 'load-failure',
          sourceId: request.sourceId,
          error: { kind: 'glob-load', glob: ['/tmp/alpha/*.ttl'], message: 'boom' },
        });
      }
    });
    const pool = new QueryWorkerPool({ spawn: () => worker });

    const result = await pool.ensureLoaded(ALPHA, RESOLVE_OPTS);

    expect(result._unsafeUnwrapErr()).toEqual({
      kind: 'glob-load',
      glob: ['/tmp/alpha/*.ttl'],
      message: 'boom',
    });
    await pool.shutdown();
  });

  it('coalesces concurrent ensureLoaded for the same source onto one load', async () => {
    let loadCount = 0;
    const worker = new FakeWorker((request, reply) => {
      if (request.type !== 'load') return;
      loadCount++;
      setTimeout(
        () =>
          reply({
            type: 'load-success',
            sourceId: request.sourceId,
            quads: 1,
            loadMs: 1,
            files: ['a.ttl'],
          }),
        2,
      );
    });
    const pool = new QueryWorkerPool({ spawn: () => worker });

    const [a, b] = await Promise.all([
      pool.ensureLoaded(ALPHA, RESOLVE_OPTS),
      pool.ensureLoaded(ALPHA, RESOLVE_OPTS),
    ]);

    expect(a._unsafeUnwrap()).toEqual({ quads: 1, loadMs: 1, files: ['a.ttl'] });
    expect(b._unsafeUnwrap()).toEqual({ quads: 1, loadMs: 1, files: ['a.ttl'] });
    expect(loadCount).toBe(1);
    await pool.shutdown();
  });
});
