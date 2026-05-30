import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSourceSpecs, type GitPort } from 'core';
import { EngineMap } from './engine-map';
import { QueryWorkerPool } from '../sparql/query-worker-pool';
import type {
  LoadRequest,
  QueryRequest,
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

  it('invalidate(id) reaches the owning worker only once the source is loaded', async () => {
    const registry = parseSourceSpecs([{ id: 'alpha', glob: join(dir, '*.ttl') }]);
    const worker = loadingWorker();
    const pool = new QueryWorkerPool({ spawn: () => worker });
    const map = await EngineMap.create(registry, { queryPool: pool });
    try {
      // Un-touched source: nothing is resident, so invalidate stays lazy — it
      // posts nothing and reports not-handled so the watcher skips it.
      expect(map.invalidate('alpha')).toBe(false);
      expect(worker.sent).toEqual([]);

      await map.ensure('alpha');

      // Loaded: invalidate reaches the worker and reports handled so the
      // watcher does not also run its legacy main-thread rebuild.
      expect(map.invalidate('alpha')).toBe(true);
      expect(worker.sent).toContainEqual({ type: 'invalidate', sourceId: 'alpha' });
    } finally {
      await map.close();
    }
  });

  it('invalidate(id) reports not-handled for an endpoint source', async () => {
    const registry = parseSourceSpecs([
      { id: 'remote', endpoint: 'http://127.0.0.1:1/sparql' },
    ]);
    const worker = loadingWorker();
    const pool = new QueryWorkerPool({ spawn: () => worker });
    const map = await EngineMap.create(registry, { queryPool: pool });
    try {
      expect(map.invalidate('remote')).toBe(false);
      expect(worker.sent).toEqual([]);
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

  it('routes an ad-hoc pinned glob query through the worker keyed by resolved SHA (#390)', async () => {
    // The served registry holds the unpinned `alpha`; the request pins a ref
    // the registered variant doesn't carry, so it bypasses `ensure` and lands
    // on the ad-hoc path that must still run off the main loop.
    const [alpha] = parseSourceSpecs([{ id: 'alpha', glob: join(dir, '*.ttl') }]);
    const PINNED_SHA = 'a'.repeat(40);
    const fakeGitPort: GitPort = {
      resolveRefToSha: async () => PINNED_SHA,
      getRefObjectType: async () => 'commit',
      readFileAtSha: async () => null,
      listFilesAtSha: async () => [],
      // eslint-disable-next-line require-yield
      readManyAtSha: async function* () {
        return;
      },
    };
    const worker = loadingWorker();
    const pool = new QueryWorkerPool({ spawn: () => worker });

    const map = await EngineMap.create([alpha], {
      queryPool: pool,
      gitPort: fakeGitPort,
      repoDiscovery: { hasGitDir: () => true },
    });
    try {
      const pinned = { ...alpha, gitRef: 'release' };
      const executor = (await map.ensureAdHoc(pinned))._unsafeUnwrap();
      const result = (
        await executor.executeResult('SELECT ?s WHERE { ?s ?p ?o }', {
          format: 'json',
        })
      )._unsafeUnwrap();
      expect(result).toEqual(QUERY_OK);

      // The store was built and queried on the worker, keyed by the resolved
      // SHA so it can't collide with the unpinned `alpha` residency.
      const routeId = `alpha@${PINNED_SHA}`;
      const loads = worker.sent.filter(
        (m): m is LoadRequest => m.type === 'load',
      );
      const queries = worker.sent.filter(
        (m): m is QueryRequest => m.type === 'query',
      );
      expect(loads.map((m) => m.sourceId)).toEqual([routeId]);
      expect(queries.map((m) => m.sourceId)).toEqual([routeId]);
    } finally {
      await map.close();
    }
  });

  it('routes an ad-hoc pinned view query through the worker keyed by its leaf glob SHA (#390)', async () => {
    // A view pinned via `@view:ref` carries `fromGitRef`, which propagates down
    // the (linear) from-chain to the leaf glob. The routing key is the leaf's
    // resolved SHA so the pinned view runs off the main loop too.
    const registry = parseSourceSpecs([
      { id: 'alpha', glob: join(dir, '*.ttl') },
      { id: 'myview', from: '@alpha', query: 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }' },
    ]);
    const view = registry.find((s) => s.id === 'myview');
    if (view === undefined) throw new Error('view fixture missing');
    const PINNED_SHA = 'b'.repeat(40);
    const fakeGitPort: GitPort = {
      resolveRefToSha: async () => PINNED_SHA,
      getRefObjectType: async () => 'commit',
      readFileAtSha: async () => null,
      listFilesAtSha: async () => [],
      // eslint-disable-next-line require-yield
      readManyAtSha: async function* () {
        return;
      },
    };
    const worker = loadingWorker();
    const pool = new QueryWorkerPool({ spawn: () => worker });
    const map = await EngineMap.create(registry, {
      queryPool: pool,
      gitPort: fakeGitPort,
      repoDiscovery: { hasGitDir: () => true },
    });
    try {
      const pinned = { ...view, fromGitRef: 'release' };
      const executor = (await map.ensureAdHoc(pinned))._unsafeUnwrap();
      const result = (
        await executor.executeResult('SELECT ?s WHERE { ?s ?p ?o }', {
          format: 'json',
        })
      )._unsafeUnwrap();
      expect(result).toEqual(QUERY_OK);

      const routeId = `myview@${PINNED_SHA}`;
      const loads = worker.sent.filter(
        (m): m is LoadRequest => m.type === 'load',
      );
      const queries = worker.sent.filter(
        (m): m is QueryRequest => m.type === 'query',
      );
      expect(loads.map((m) => m.sourceId)).toEqual([routeId]);
      expect(queries.map((m) => m.sourceId)).toEqual([routeId]);
    } finally {
      await map.close();
    }
  });

  it('keys ad-hoc residency by resolved SHA so distinct commits route apart and a repeat pin reuses the slot (#390)', async () => {
    const [alpha] = parseSourceSpecs([{ id: 'alpha', glob: join(dir, '*.ttl') }]);
    const SHA = { v1: '1'.repeat(40), v2: '2'.repeat(40) } as const;
    const fakeGitPort: GitPort = {
      resolveRefToSha: async (_root, ref) =>
        SHA[ref as keyof typeof SHA] ?? null,
      getRefObjectType: async () => 'commit',
      readFileAtSha: async () => null,
      listFilesAtSha: async () => [],
      // eslint-disable-next-line require-yield
      readManyAtSha: async function* () {
        return;
      },
    };
    const worker = loadingWorker();
    const pool = new QueryWorkerPool({ spawn: () => worker });
    const map = await EngineMap.create([alpha], {
      queryPool: pool,
      gitPort: fakeGitPort,
      repoDiscovery: { hasGitDir: () => true },
    });
    try {
      const run = async (ref: string): Promise<void> => {
        const executor = (
          await map.ensureAdHoc({ ...alpha, gitRef: ref })
        )._unsafeUnwrap();
        (
          await executor.executeResult('SELECT ?s WHERE { ?s ?p ?o }', {
            format: 'json',
          })
        )._unsafeUnwrap();
      };
      await run('v1');
      await run('v1');
      await run('v2');

      // Each request routes by its commit, so the two `v1` queries share a key
      // (one residency slot) while `v2` is a distinct slot — never colliding.
      const queryKeys = worker.sent
        .filter((m): m is QueryRequest => m.type === 'query')
        .map((m) => m.sourceId);
      expect(queryKeys).toEqual([
        `alpha@${SHA.v1}`,
        `alpha@${SHA.v1}`,
        `alpha@${SHA.v2}`,
      ]);
    } finally {
      await map.close();
    }
  });

  it('Reload drops the worker residency before re-loading so the rebuild is real', async () => {
    const registry = parseSourceSpecs([{ id: 'alpha', glob: join(dir, '*.ttl') }]);
    const worker = loadingWorker();
    const pool = new QueryWorkerPool({ spawn: () => worker });
    const map = await EngineMap.create(registry, { queryPool: pool });
    try {
      await map.ensure('alpha');
      await map.reload('alpha');

      // Reload posts invalidate (drop) *then* load (rebuild) — not a bare
      // re-load, which the worker would answer from its still-resident store
      // without rebuilding.
      expect(worker.sent.map((m) => m.type)).toEqual(['load', 'invalidate', 'load']);
      expect((await map.readState('alpha')).state).toBe('loaded');
    } finally {
      await map.close();
    }
  });

  it('Unload drops the worker residency so it stays gone until the next query', async () => {
    const registry = parseSourceSpecs([{ id: 'alpha', glob: join(dir, '*.ttl') }]);
    const worker = loadingWorker();
    const pool = new QueryWorkerPool({ spawn: () => worker });
    const map = await EngineMap.create(registry, { queryPool: pool });
    try {
      await map.ensure('alpha');
      await map.unload('alpha');

      // Unload drops the worker's resident store and the main mirror; it does
      // not re-load (no rebuild until the next query).
      expect(worker.sent.map((m) => m.type)).toEqual(['load', 'invalidate']);
      expect(await map.readState('alpha')).toEqual({
        mode: 'in-memory',
        state: 'not-loaded',
      });
    } finally {
      await map.close();
    }
  });

  it('discards a reload that completes after an Unload — the late load-success must not resurrect the unloaded entry', async () => {
    const registry = parseSourceSpecs([{ id: 'alpha', glob: join(dir, '*.ttl') }]);
    let loadCount = 0;
    let releaseReload: (() => void) | undefined;
    // The initial ensure's load answers immediately; the reload's rebuild is
    // held open so an Unload can land while that worker round-trip is still in
    // flight — the exact ordering that wedges the Sources page on `loaded`.
    const worker = new FakeWorker((request, reply) => {
      if (request.type === 'load') {
        loadCount += 1;
        const send = (): void =>
          reply({
            type: 'load-success',
            sourceId: request.sourceId,
            quads: 5,
            loadMs: 3,
            files: ['a.ttl'],
          });
        if (loadCount === 1) send();
        else releaseReload = send;
      } else if (request.type === 'query') {
        reply({ type: 'query-result', requestId: request.requestId, ok: QUERY_OK });
      }
      // `invalidate` is fire-and-forget — nothing to reply.
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
      await map.ensure('alpha');
      expect((await map.readState('alpha')).state).toBe('loaded');

      // Reload's worker rebuild is now in flight (held open by the fake worker).
      const reloadP = map.reload('alpha');
      await new Promise((r) => setImmediate(r));
      expect(releaseReload).toBeDefined();

      // Unload lands mid-reload: clears the main mirror and drops residency.
      await map.unload('alpha');
      expect((await map.readState('alpha')).state).toBe('not-loaded');

      // The held reload now completes. It must NOT re-populate the entry.
      releaseReload?.();
      await reloadP;

      expect(await map.readState('alpha')).toEqual({
        mode: 'in-memory',
        state: 'not-loaded',
      });
      // The last lifecycle event the Sources page sees is the unload — not a
      // stale load-success that would flip the row back to `loaded`.
      expect(events.at(-1)?.kind).toBe('unload');
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
