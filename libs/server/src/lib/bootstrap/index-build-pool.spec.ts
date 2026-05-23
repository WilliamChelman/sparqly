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

/**
 * Extends {@link FakeChild} with a synthetic `stderr` readable so the pool
 * can capture the rolling tail it surfaces in {@link BuildChild} failures
 * (#360). Real `ChildProcess` exposes `stderr` as a `Readable`; the pool only
 * binds to the `data` event, so the stand-in keeps the surface minimal.
 */
class FakeChildWithStderr extends FakeChild {
  private readonly stderrListeners: Array<(chunk: Buffer | string) => void> =
    [];

  readonly stderr = {
    on: (event: 'data', listener: (chunk: Buffer | string) => void): void => {
      if (event === 'data') this.stderrListeners.push(listener);
    },
  };

  writeStderr(chunk: string): void {
    for (const listener of this.stderrListeners) listener(chunk);
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

  it('a non-zero exit puts the source in a cooldown — request() within the window is a no-op (no spawn storm on a permanently failing build)', () => {
    const spawned: string[] = [];
    const children = new Map<string, FakeChild>();
    const spawn: SpawnIndexBuild = (id) => {
      spawned.push(id);
      const child = new FakeChild();
      children.set(id, child);
      return child;
    };
    let clock = 1_000;
    const pool = new IndexBuildPool({
      concurrency: 1,
      spawn,
      cooldownMs: 30_000,
      now: () => clock,
    });

    pool.request('bad');
    children.get('bad')?.exit(1); // build failed (malformed RDF)

    // Many HTTP touches in rapid succession — the storm the finding describes.
    clock += 10;
    for (let i = 0; i < 50; i++) pool.request('bad');

    // Only the original spawn happened — the cooldown suppressed the storm.
    expect(spawned).toEqual(['bad']);
  });

  it('a spawn `error` (no exit ever fires) also puts the source in cooldown — a permanently broken spawn does not storm', () => {
    const spawned: string[] = [];
    const children = new Map<string, FakeChild>();
    const spawn: SpawnIndexBuild = (id) => {
      spawned.push(id);
      const child = new FakeChild();
      children.set(id, child);
      return child;
    };
    let clock = 1_000;
    const pool = new IndexBuildPool({
      concurrency: 1,
      spawn,
      cooldownMs: 30_000,
      now: () => clock,
    });

    pool.request('bad');
    children.get('bad')?.emitError(new Error('spawn ENOENT'));

    clock += 10;
    pool.request('bad');
    pool.request('bad');

    expect(spawned).toEqual(['bad']);
  });

  it('a successful exit (code 0) clears any prior failure — the next request after a successful build spawns again', () => {
    const spawned: string[] = [];
    const children = new Map<string, FakeChild>();
    const spawn: SpawnIndexBuild = (id) => {
      spawned.push(id);
      const child = new FakeChild();
      // Re-set the latest child under the same id so the test fires the
      // most recent build's `exit`.
      children.set(id, child);
      return child;
    };
    let clock = 1_000;
    const pool = new IndexBuildPool({
      concurrency: 1,
      spawn,
      cooldownMs: 30_000,
      now: () => clock,
    });

    // First build fails — source enters cooldown.
    pool.request('flaky');
    children.get('flaky')?.exit(1);

    clock += 10;
    pool.request('flaky');
    expect(spawned).toEqual(['flaky']); // still in cooldown — suppressed

    // The cooldown window passes naturally — the build is re-attempted and
    // this time succeeds.
    clock += 30_000;
    pool.request('flaky');
    expect(spawned).toEqual(['flaky', 'flaky']);
    children.get('flaky')?.exit(0);

    // After the success, a fresh request must spawn again immediately — the
    // cooldown carried over from the earlier failure must not gate a healthy
    // source.
    clock += 10;
    pool.request('flaky');
    expect(spawned).toEqual(['flaky', 'flaky', 'flaky']);
  });

  it('cooldown expires once the clock advances past cooldownMs — request() spawns again', () => {
    const spawned: string[] = [];
    const children = new Map<string, FakeChild>();
    const spawn: SpawnIndexBuild = (id) => {
      spawned.push(id);
      const child = new FakeChild();
      children.set(id, child);
      return child;
    };
    let clock = 1_000;
    const pool = new IndexBuildPool({
      concurrency: 1,
      spawn,
      cooldownMs: 30_000,
      now: () => clock,
    });

    pool.request('bad');
    children.get('bad')?.exit(1);

    // Just before the window closes — still suppressed.
    clock += 29_999;
    pool.request('bad');
    expect(spawned).toEqual(['bad']);

    // Window has closed — the next request spawns.
    clock += 2;
    pool.request('bad');
    expect(spawned).toEqual(['bad', 'bad']);
  });

  it('cancel(id) on a running build SIGTERMs the child and invokes the injected temp-dir sweeper (ADR-0043, #358)', () => {
    const swept: string[] = [];
    const children = new Map<string, FakeChild>();
    const spawn: SpawnIndexBuild = (id) => {
      const child = new FakeChild();
      children.set(id, child);
      return child;
    };
    const pool = new IndexBuildPool({
      concurrency: 1,
      spawn,
      sweepTempDir: (id) => {
        swept.push(id);
        return Promise.resolve();
      },
    });

    pool.request('big');
    pool.cancel('big');

    // The child receives a SIGTERM in response to the cancel — sparqly never
    // lets a disowned build keep burning CPU on a multi-GB index (ADR-0043).
    expect(children.get('big')?.killed).toBe('SIGTERM');

    // Sweep does not fire before the child exits — the temp dir is still in
    // active use up to that point; sweeping it under a still-writing child is
    // exactly the race the ADR-0042 atomic-rename pattern exists to avoid.
    expect(swept).toEqual([]);

    // The child exits in response to the signal (null code — signalled). The
    // pool's cleanup hook now runs the sweeper for that source's temp dir.
    children.get('big')?.exit(null);
    expect(swept).toEqual(['big']);
  });

  it('cancel(id) of an unknown source is a silent no-op — the sweeper never fires', () => {
    const swept: string[] = [];
    const pool = new IndexBuildPool({
      concurrency: 1,
      spawn: () => new FakeChild(),
      sweepTempDir: (id) => {
        swept.push(id);
        return Promise.resolve();
      },
    });

    // The pool has no running or queued entry for 'ghost'. Cancel must not
    // throw and must not invoke the sweeper.
    expect(() => pool.cancel('ghost')).not.toThrow();
    expect(swept).toEqual([]);
  });

  it('cancel(id) of a queued (not-yet-spawned) source drops it from the queue and never spawns it', () => {
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
    pool.request('b'); // queued — past the cap.
    expect(spawned).toEqual(['a']);

    // Disowning the queued 'b' before it runs is a pure queue-drop: no child
    // exists to SIGTERM, no temp dir exists to sweep.
    pool.cancel('b');

    // 'a' finishing must not promote the now-cancelled 'b' — the queue is
    // empty.
    children.get('a')?.exit(0);
    expect(spawned).toEqual(['a']);
  });

  it('cancel(id) clears any prior failure cooldown for the same id — a cancelled build is not a failed build (ADR-0043)', () => {
    const spawned: string[] = [];
    const children = new Map<string, FakeChild>();
    const spawn: SpawnIndexBuild = (id) => {
      spawned.push(id);
      const child = new FakeChild();
      children.set(id, child);
      return child;
    };
    let clock = 1_000;
    const pool = new IndexBuildPool({
      concurrency: 1,
      spawn,
      cooldownMs: 30_000,
      now: () => clock,
    });

    pool.request('big');
    pool.cancel('big');
    children.get('big')?.exit(null); // signalled — null code

    // A follow-up trigger inside what would have been the failure cooldown
    // window must still spawn — the user undid the prior build, they did not
    // discover it was broken.
    clock += 10;
    pool.request('big');
    expect(spawned).toEqual(['big', 'big']);
  });

  /*
   * #360: the Sources page needs `kind`, `message`, and a stderr-tail
   * `details` to render the inline error chip + Show details expander on a
   * `failed` disk-backed row. The pool is the only layer that sees the
   * child's stderr stream and exit code, so the failure metadata originates
   * here and rides onSettle's optional third argument.
   */
  it('onSettle(id, "failure", info) carries kind=index-build-failed, the exit reason as message, and the stderr tail as details (#360)', () => {
    const settled: Array<{
      id: string;
      outcome: 'success' | 'failure' | 'cancel';
      info?: { kind: string; message: string; details?: string };
    }> = [];
    const child = new FakeChildWithStderr();
    const pool = new IndexBuildPool({
      concurrency: 1,
      spawn: () => child,
      onSettle: (id, outcome, info) => settled.push({ id, outcome, info }),
    });

    pool.request('broken');
    child.writeStderr('parsing /data/a.nq\n');
    child.writeStderr('Error: bad triple at line 42\n');
    child.exit(1);

    expect(settled).toHaveLength(1);
    expect(settled[0].outcome).toBe('failure');
    expect(settled[0].info?.kind).toBe('index-build-failed');
    expect(settled[0].info?.message).toBe('exit code 1');
    expect(settled[0].info?.details).toContain('Error: bad triple at line 42');
  });

  it('onSettle("failure", info) on a spawn `error` reports the error message (no stderr captured) (#360)', () => {
    const settled: Array<{
      info?: { kind: string; message: string; details?: string };
    }> = [];
    const child = new FakeChildWithStderr();
    const pool = new IndexBuildPool({
      concurrency: 1,
      spawn: () => child,
      onSettle: (_id, _outcome, info) => settled.push({ info }),
    });

    pool.request('broken');
    child.emitError(new Error('ENOENT: no such file or directory, posix_spawn'));

    expect(settled[0].info?.kind).toBe('index-build-failed');
    expect(settled[0].info?.message).toContain('ENOENT');
    // No stderr was ever written; details stays absent rather than empty.
    expect(settled[0].info?.details).toBeUndefined();
  });

  it('onSettle(id, "success") is invoked without an info argument (the third slot exists for failures only) (#360)', () => {
    const args: Array<{ outcome: string; hasInfo: boolean }> = [];
    const child = new FakeChild();
    const pool = new IndexBuildPool({
      concurrency: 1,
      spawn: () => child,
      onSettle: (_id, outcome, info) => {
        args.push({ outcome, hasInfo: info !== undefined });
      },
    });

    pool.request('happy');
    child.exit(0);

    expect(args).toEqual([{ outcome: 'success', hasInfo: false }]);
  });

  it('onSettle(id, outcome) is invoked once per child — success / failure / cancel — so EngineMap can emit build-* transitions (#358)', () => {
    const settled: Array<{ id: string; outcome: 'success' | 'failure' | 'cancel' }> = [];
    const children = new Map<string, FakeChild>();
    const spawn: SpawnIndexBuild = (id) => {
      const child = new FakeChild();
      children.set(id, child);
      return child;
    };
    const pool = new IndexBuildPool({
      concurrency: 3,
      spawn,
      onSettle: (id, outcome) => settled.push({ id, outcome }),
    });

    pool.request('happy');
    pool.request('broken');
    pool.request('cancelled');

    children.get('happy')?.exit(0); // clean exit → success
    children.get('broken')?.exit(1); // non-zero → failure
    pool.cancel('cancelled');
    children.get('cancelled')?.exit(null); // signalled → cancel

    expect(settled).toEqual([
      { id: 'happy', outcome: 'success' },
      { id: 'broken', outcome: 'failure' },
      { id: 'cancelled', outcome: 'cancel' },
    ]);
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
