import { describe, expect, it } from 'vitest';
import {
  IndexBuildPool,
  type BuildChild,
  type SpawnIndexBuild,
} from './index-build-pool';

/**
 * Synthetic stand-in for a `sparqly index` child process — exposes the minimal
 * {@link BuildChild} surface the pool drives and lets a test fire `exit` on
 * demand, so the pool's spawn / cap / queue / shutdown behaviour is exercised
 * without real processes.
 */
class FakeChild implements BuildChild {
  private readonly exitListeners: Array<(code: number | null) => void> = [];
  private readonly errorListeners: Array<(err: Error) => void> = [];
  killed: 'SIGTERM' | undefined;

  on(event: 'exit', listener: (code: number | null) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  on(
    event: 'exit' | 'error',
    listener:
      | ((code: number | null) => void)
      | ((err: Error) => void),
  ): void {
    if (event === 'exit') {
      this.exitListeners.push(listener as (code: number | null) => void);
    } else {
      this.errorListeners.push(listener as (err: Error) => void);
    }
  }

  kill(signal: 'SIGTERM'): void {
    this.killed = signal;
  }

  /** Fires the `exit` event — the test stand-in for the child finishing. */
  exit(code: number | null): void {
    for (const listener of this.exitListeners) listener(code);
  }

  /**
   * Fires the `error` event — the test stand-in for a spawn failure (ENOENT
   * bad cliEntry / nodeBin). Per Node's `child_process`, a spawn failure emits
   * `'error'` and never `'exit'`.
   */
  emitError(err: Error): void {
    for (const listener of this.errorListeners) listener(err);
  }
}

describe('IndexBuildPool', () => {
  it('request(id) spawns an index-build child for that source id', () => {
    const spawned: string[] = [];
    const spawn: SpawnIndexBuild = (id) => {
      spawned.push(id);
      return new FakeChild();
    };
    const pool = new IndexBuildPool({ concurrency: 2, spawn });

    pool.request('big');

    expect(spawned).toEqual(['big']);
  });

  it('request(id) for an id already building is a no-op — the child spawns once', () => {
    const spawned: string[] = [];
    const spawn: SpawnIndexBuild = (id) => {
      spawned.push(id);
      return new FakeChild();
    };
    const pool = new IndexBuildPool({ concurrency: 2, spawn });

    pool.request('big');
    pool.request('big');
    pool.request('big');

    expect(spawned).toEqual(['big']);
  });

  it('queues a request past the concurrency cap and drains it when a running child exits', () => {
    const spawned: string[] = [];
    const children = new Map<string, FakeChild>();
    const spawn: SpawnIndexBuild = (id) => {
      spawned.push(id);
      const child = new FakeChild();
      children.set(id, child);
      return child;
    };
    const pool = new IndexBuildPool({ concurrency: 2, spawn });

    pool.request('a');
    pool.request('b');
    pool.request('c');

    // 'c' is over the cap of 2 — it queues rather than spawning a third child.
    expect(spawned).toEqual(['a', 'b']);

    // 'a' finishes — the queued 'c' takes its slot.
    children.get('a')?.exit(0);
    expect(spawned).toEqual(['a', 'b', 'c']);
  });

  it('request(id) for an already-queued id is a no-op — the queued id spawns once', () => {
    const spawned: string[] = [];
    const children = new Map<string, FakeChild>();
    const spawn: SpawnIndexBuild = (id) => {
      spawned.push(id);
      const child = new FakeChild();
      children.set(id, child);
      return child;
    };
    const pool = new IndexBuildPool({ concurrency: 1, spawn });

    pool.request('a');
    pool.request('b');
    pool.request('b');

    expect(spawned).toEqual(['a']);

    children.get('a')?.exit(0);
    expect(spawned).toEqual(['a', 'b']);
  });

  it('shutdown() SIGTERMs every running child, drops the queue, and resolves once children exit', async () => {
    const spawned: string[] = [];
    const children = new Map<string, FakeChild>();
    const spawn: SpawnIndexBuild = (id) => {
      spawned.push(id);
      const child = new FakeChild();
      children.set(id, child);
      return child;
    };
    const pool = new IndexBuildPool({ concurrency: 2, spawn });

    pool.request('a');
    pool.request('b');
    pool.request('c');

    const shutdown = pool.shutdown();

    // Both running children are SIGTERM'd.
    expect(children.get('a')?.killed).toBe('SIGTERM');
    expect(children.get('b')?.killed).toBe('SIGTERM');

    // shutdown() stays pending until the killed children have actually exited.
    let settled = false;
    void shutdown.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    children.get('a')?.exit(null);
    children.get('b')?.exit(null);
    await shutdown;
    expect(settled).toBe(true);

    // The queued 'c' was dropped — a child that exits during shutdown does not
    // drain the queue, so 'c' is never spawned.
    expect(spawned).toEqual(['a', 'b']);
  });

  it('a child that fails to spawn (fires "error" without "exit") frees its slot and drains the queue', () => {
    const spawned: string[] = [];
    const children = new Map<string, FakeChild>();
    const spawn: SpawnIndexBuild = (id) => {
      spawned.push(id);
      const child = new FakeChild();
      children.set(id, child);
      return child;
    };
    const pool = new IndexBuildPool({ concurrency: 1, spawn });

    pool.request('a');
    pool.request('b');
    expect(spawned).toEqual(['a']);

    // 'a' fails to spawn (e.g. ENOENT bad cliEntry) — emits 'error' and never
    // 'exit'. The slot must still free so the queued 'b' takes over.
    children.get('a')?.emitError(new Error('spawn ENOENT'));

    expect(spawned).toEqual(['a', 'b']);
  });

  it('shutdown() resolves even when a running child fails to spawn (errors instead of exits)', async () => {
    const children = new Map<string, FakeChild>();
    const spawn: SpawnIndexBuild = (id) => {
      const child = new FakeChild();
      children.set(id, child);
      return child;
    };
    const pool = new IndexBuildPool({ concurrency: 2, spawn });

    pool.request('a');
    pool.request('b');

    const shutdown = pool.shutdown();
    let settled = false;
    void shutdown.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    // Spawn failure path — 'a' errors, 'b' exits normally. shutdown() must not
    // hang on the errored child.
    children.get('a')?.emitError(new Error('spawn ENOENT'));
    children.get('b')?.exit(null);
    await shutdown;
    expect(settled).toBe(true);
  });

  it('a child that fires both "error" and "exit" only drains the queue once', () => {
    const spawned: string[] = [];
    const children = new Map<string, FakeChild>();
    const spawn: SpawnIndexBuild = (id) => {
      spawned.push(id);
      const child = new FakeChild();
      children.set(id, child);
      return child;
    };
    const pool = new IndexBuildPool({ concurrency: 1, spawn });

    pool.request('a');
    pool.request('b');
    pool.request('c');

    // Defensive: on some platforms a spawn failure can fire both events. The
    // cleanup must be idempotent — 'b' takes 'a's slot, 'c' stays queued.
    children.get('a')?.emitError(new Error('spawn ENOENT'));
    children.get('a')?.exit(null);

    expect(spawned).toEqual(['a', 'b']);
  });

  it('whenIdle() resolves once every running and queued build has settled', async () => {
    const children = new Map<string, FakeChild>();
    const spawn: SpawnIndexBuild = (id) => {
      const child = new FakeChild();
      children.set(id, child);
      return child;
    };
    const pool = new IndexBuildPool({ concurrency: 1, spawn });

    pool.request('a');
    pool.request('b');

    const idle = pool.whenIdle();
    let settled = false;
    void idle.then(() => {
      settled = true;
    });

    // 'a' done — the queued 'b' takes the slot, so the pool is still busy.
    children.get('a')?.exit(0);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    children.get('b')?.exit(0);
    await idle;
    expect(settled).toBe(true);
  });
});
