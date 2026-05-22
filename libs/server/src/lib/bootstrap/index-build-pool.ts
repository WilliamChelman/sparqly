/**
 * The minimal child-process surface {@link IndexBuildPool} drives — Node's
 * `ChildProcess` satisfies it structurally, so production passes a real spawned
 * process and tests pass a synthetic stand-in.
 */
export interface BuildChild {
  on(event: 'exit', listener: (code: number | null) => void): void;
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
  /** Build children currently running, keyed by source `@id`. */
  private readonly running = new Map<string, RunningBuild>();
  /** Source `@id`s requested past the cap, waiting for a free slot. */
  private readonly queue: string[] = [];
  /** Set by {@link shutdown}; suppresses new spawns and queue draining. */
  private shuttingDown = false;

  constructor(options: IndexBuildPoolOptions) {
    this.concurrency = options.concurrency;
    this.spawnChild = options.spawn;
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
    if (this.running.size < this.concurrency) {
      this.start(sourceId);
    } else {
      this.queue.push(sourceId);
    }
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
    child.on('exit', () => {
      this.running.delete(sourceId);
      markExited();
      if (this.shuttingDown) return;
      const next = this.queue.shift();
      if (next !== undefined) this.start(next);
    });
  }
}

interface RunningBuild {
  child: BuildChild;
  /** Resolves when this build child fires `exit`. */
  exited: Promise<void>;
}
