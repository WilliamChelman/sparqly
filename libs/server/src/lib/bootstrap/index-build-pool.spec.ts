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
  killed: 'SIGTERM' | undefined;

  on(event: 'exit', listener: (code: number | null) => void): void {
    if (event === 'exit') this.exitListeners.push(listener);
  }

  kill(signal: 'SIGTERM'): void {
    this.killed = signal;
  }

  /** Fires the `exit` event — the test stand-in for the child finishing. */
  exit(code: number | null): void {
    for (const listener of this.exitListeners) listener(code);
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
