/**
 * The minimal child-process surface {@link IndexBuildPool} drives — Node's
 * `ChildProcess` satisfies it structurally, so production passes a real spawned
 * process and tests pass a synthetic stand-in.
 */
export interface BuildChild {
  on(event: 'exit', listener: (code: number | null) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  kill(signal: 'SIGTERM'): void;
}

/**
 * Spawns `sparqly index @<sourceId>` as an isolated child process (ADR-0042).
 * Injected into {@link IndexBuildPool} so `libs/server` stays decoupled from the
 * CLI entry point that knows how to re-invoke itself.
 */
export type SpawnIndexBuild = (sourceId: string) => BuildChild;

export interface IndexBuildPoolOptions {
  /** Maximum number of build children running at once (`index.concurrency`). */
  concurrency: number;
  spawn: SpawnIndexBuild;
  /**
   * Window after a failing build during which {@link IndexBuildPool.request}
   * for the same source is a no-op — caps the spawn rate so a permanently
   * failing source (e.g. a malformed RDF file) does not turn every HTTP touch
   * into a fresh `sparqly index` child. A successful exit clears the failure.
   * Defaults to 30 seconds.
   */
  cooldownMs?: number;
  /** Clock injection for tests; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Caps and queues the isolated child-process Glob index builds `serve` kicks on
 * first touch of a disk-backed source (ADR-0042). The build runs in its own
 * process — own event loop, libuv threadpool, and heap — so `serve`'s HTTP loop
 * never blocks and a build OOM kills only the child.
 */
export class IndexBuildPool {
  private readonly concurrency: number;
  private readonly spawnChild: SpawnIndexBuild;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  /** Build children currently running, keyed by source `@id`. */
  private readonly running = new Map<string, RunningBuild>();
  /** Source `@id`s requested past the cap, waiting for a free slot. */
  private readonly queue: string[] = [];
  /**
   * Wall-clock instant of the most recent failing build per source `@id`.
   * Populated on a non-zero exit or a spawn `error`; cleared on a clean exit
   * (`code === 0`). Drives the per-source backoff that caps `request()` to one
   * spawn per cooldown window — without it a permanently failing build (e.g. a
   * malformed RDF file) turns every HTTP touch into a fresh child.
   */
  private readonly lastFailureAt = new Map<string, number>();
  /** Set by {@link shutdown}; suppresses new spawns and queue draining. */
  private shuttingDown = false;

  constructor(options: IndexBuildPoolOptions) {
    this.concurrency = options.concurrency;
    this.spawnChild = options.spawn;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  /**
   * Requests a background index build for `sourceId`. Idempotent — a source
   * already building or queued is left alone, so concurrent first-touches of
   * the same disk-backed glob spawn exactly one child. Concurrency-capped at
   * `index.concurrency`; a request past the cap queues until a slot frees.
   */
  request(sourceId: string): void {
    if (this.shuttingDown) return;
    if (this.running.has(sourceId)) return;
    if (this.queue.includes(sourceId)) return;
    if (this.isInCooldown(sourceId)) return;
    if (this.running.size < this.concurrency) {
      this.start(sourceId);
    } else {
      this.queue.push(sourceId);
    }
  }

  /**
   * Reports whether a build child is currently running or queued for `sourceId`
   * (#357). Read by `projectEntryState` so a disk-backed source whose Glob
   * index build is in flight surfaces as `indexing` on the Sources page —
   * `entry.disk` alone can't tell that apart from "already opened" once the
   * memoized resolution settled.
   */
  isBuilding(sourceId: string): boolean {
    return this.running.has(sourceId) || this.queue.includes(sourceId);
  }

  private isInCooldown(sourceId: string): boolean {
    const at = this.lastFailureAt.get(sourceId);
    if (at === undefined) return false;
    return this.now() - at < this.cooldownMs;
  }

  /**
   * Resolves once no build is running or queued. Used by graceful shutdown and
   * by tests to await a disk-backed glob's child build before reading its
   * `ready` state.
   */
  async whenIdle(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.all(
        [...this.running.values()].map((build) => build.exited),
      );
    }
  }

  /**
   * SIGTERMs every running build child, drops the queue, and resolves once the
   * children have exited — so `serve` shutdown (Ctrl-C) leaves no orphaned
   * builds (ADR-0042).
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.queue.length = 0;
    const exits = [...this.running.values()].map((build) => build.exited);
    for (const build of this.running.values()) build.child.kill('SIGTERM');
    await Promise.all(exits);
  }

  private start(sourceId: string): void {
    let markExited!: () => void;
    const exited = new Promise<void>((resolve) => {
      markExited = resolve;
    });
    const child = this.spawnChild(sourceId);
    this.running.set(sourceId, { child, exited });
    // A spawn failure (ENOENT bad cliEntry/nodeBin) emits `'error'` and never
    // `'exit'` — without an `'error'` handler the slot would never free and
    // `whenIdle`/`shutdown` would hang. Both handlers funnel into idempotent
    // cleanup so a child that fires both events only drains the queue once.
    let settled = false;
    const settle = (failed: boolean): void => {
      if (settled) return;
      settled = true;
      this.running.delete(sourceId);
      if (failed) {
        this.lastFailureAt.set(sourceId, this.now());
      } else {
        this.lastFailureAt.delete(sourceId);
      }
      markExited();
      if (this.shuttingDown) return;
      const next = this.queue.shift();
      if (next !== undefined) this.start(next);
    };
    // Treat any non-zero / null exit code as a failure so the cooldown applies
    // — a `null` code means the child was signalled, and a signalled build
    // wrote no manifest just like a non-zero exit. `'error'` (spawn failure)
    // is unambiguously a failure.
    child.on('exit', (code) => settle(code !== 0));
    child.on('error', () => settle(true));
  }
}

interface RunningBuild {
  child: BuildChild;
  /** Resolves when this build child fires `exit`. */
  exited: Promise<void>;
}
