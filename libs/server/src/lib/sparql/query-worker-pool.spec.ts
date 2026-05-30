import { describe, expect, it } from 'vitest';
import type { ExecuteResult, ParsedSource } from 'core';
import { QueryWorkerPool } from './query-worker-pool';
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
