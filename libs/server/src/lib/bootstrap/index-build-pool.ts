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
  /**
   * Sweeps the cancelled build's temp directory (ADR-0042's
   * `<indexDir>.building-<pid>-*`) after the SIGTERMed child exits. Injected
   * from `EngineMap`, which knows where each source's `indexDir` lives — the
   * pool itself only sees `@id`s. Omit to make {@link IndexBuildPool.cancel}
   * a no-op for the sweep half (the kill half still fires) — useful in tests
   * that don't care about the on-disk side. Awaited inside the exit listener
   * so a cancel-induced exit completes its cleanup before the next queued
   * build takes the freed slot.
   */
  sweepTempDir?: (sourceId: string) => Promise<void>;
  /**
   * Per-build settlement callback (ADR-0044, #358). Invoked exactly once per
   * spawned child, after the slot has freed: `'success'` for a `code === 0`
   * exit, `'failure'` for any other exit or spawn `'error'`, `'cancel'` for an
   * exit that followed a {@link IndexBuildPool.cancel} request. The pool
   * itself stays decoupled from the SSE stream — `EngineMap` subscribes here
   * and maps each outcome to a `build-success` / `build-failure` /
   * `build-cancel` transition so the Sources page sees the row update.
   */
  onSettle?: (
    sourceId: string,
    outcome: 'success' | 'failure' | 'cancel',
  ) => void;
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
  private readonly sweepTempDir: ((sourceId: string) => Promise<void>) | undefined;
  private readonly onSettle:
    | ((sourceId: string, outcome: 'success' | 'failure' | 'cancel') => void)
    | undefined;
  /** Build children currently running, keyed by source `@id`. */
  private readonly running = new Map<string, RunningBuild>();
  /**
   * Source ids whose running child was cancelled via {@link cancel}. The exit
   * listener consults this set so a cancel-induced exit (a) skips the
   * cooldown bookkeeping a normal failure triggers and (b) fires the temp-dir
   * sweep. Cleared when the child finishes settling.
   */
  private readonly cancelling = new Set<string>();
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
    this.sweepTempDir = options.sweepTempDir;
    this.onSettle = options.onSettle;
  }

  /**
   * User-triggered cancel of an in-flight Glob index build (ADR-0043, #358).
   * SIGTERMs the running child and — once the child exits — runs the injected
   * {@link IndexBuildPoolOptions.sweepTempDir} so the partial temp dir doesn't
   * linger. The cancel-induced exit is *not* treated as a failure: no
   * cooldown entry is recorded, so a follow-up rebuild can spawn immediately
   * (the cancel was a user decision, not a broken source). Cancel of an
   * unknown id — or an id sitting in the post-failure cooldown window with
   * no live child — is a silent no-op.
   */
  cancel(sourceId: string): void {
    // Drop a queued-but-not-yet-spawned request — the user disowned this
    // build before it even started, so there's no child to SIGTERM and no
    // temp dir to sweep.
    const queueIndex = this.queue.indexOf(sourceId);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
      return;
    }
    const running = this.running.get(sourceId);
    if (running === undefined) return; // unknown id or cooldown — no-op.
    this.cancelling.add(sourceId);
    running.child.kill('SIGTERM');
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
    if (this.checkCooldown(sourceId)) return;
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

  /**
   * Reports whether {@link request} would currently be suppressed by the
   * post-failure cooldown window for `sourceId` (#358). Read by the
   * `POST /api/sources/:id/index-build` route so it can refuse with
   * `429 Too Many Requests` instead of silently swallowing the trigger.
   */
  isInCooldown(sourceId: string): boolean {
    return this.checkCooldown(sourceId);
  }

  private checkCooldown(sourceId: string): boolean {
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
      const cancelled = this.cancelling.delete(sourceId);
      let outcome: 'success' | 'failure' | 'cancel';
      if (cancelled) {
        // A cancel-induced exit is a user decision, not a broken build — skip
        // the cooldown bookkeeping so a follow-up rebuild trigger can spawn
        // immediately (ADR-0043's "cheap, always-safe undo" property). Run
        // the injected sweep so the temp dir doesn't linger after the kill.
        this.lastFailureAt.delete(sourceId);
        if (this.sweepTempDir) {
          void this.sweepTempDir(sourceId);
        }
        outcome = 'cancel';
      } else if (failed) {
        this.lastFailureAt.set(sourceId, this.now());
        outcome = 'failure';
      } else {
        this.lastFailureAt.delete(sourceId);
        outcome = 'success';
      }
      markExited();
      this.onSettle?.(sourceId, outcome);
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
