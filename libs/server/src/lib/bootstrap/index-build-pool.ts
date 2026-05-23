/** Structural surface of `ChildProcess` the pool drives — tests pass a stand-in. */
export interface BuildChild {
  on(event: 'exit', listener: (code: number | null) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  kill(signal: 'SIGTERM'): void;
  stderr?: BuildChildStderr | null;
}

export interface BuildChildStderr {
  on(event: 'data', listener: (chunk: Buffer | string) => void): void;
}

export interface BuildFailureInfo {
  kind: 'index-build-failed';
  /** `'exit code N'`, `'signalled'`, or the spawn error message. */
  message: string;
  /** Rolling tail of the child's stderr. */
  details?: string;
}

export type SpawnIndexBuild = (sourceId: string) => BuildChild;

export interface IndexBuildPoolOptions {
  concurrency: number;
  spawn: SpawnIndexBuild;
  /** Suppresses repeat requests after a failure. Defaults to 30s. */
  cooldownMs?: number;
  now?: () => number;
  /**
   * Sweeps the cancelled build's `.building-<pid>-*` temp dir after the
   * SIGTERMed child exits. Awaited inside the exit listener so cleanup
   * completes before the next queued build takes the freed slot.
   */
  sweepTempDir?: (sourceId: string) => Promise<void>;
  /**
   * Invoked exactly once per spawned child after the slot frees. `info` is
   * present on every `'failure'` outcome and absent on success/cancel.
   */
  onSettle?: (
    sourceId: string,
    outcome: 'success' | 'failure' | 'cancel',
    info?: BuildFailureInfo,
  ) => void;
  /** Max stderr bytes retained for {@link BuildFailureInfo.details}. Defaults to 4 KiB. */
  stderrTailBytes?: number;
}

/**
 * Caps and queues child-process Glob index builds. Each build runs in its own
 * process so `serve`'s HTTP loop never blocks and a build OOM kills only the child.
 */
export class IndexBuildPool {
  private readonly concurrency: number;
  private readonly spawnChild: SpawnIndexBuild;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly sweepTempDir: ((sourceId: string) => Promise<void>) | undefined;
  private readonly onSettle:
    | ((
        sourceId: string,
        outcome: 'success' | 'failure' | 'cancel',
        info?: BuildFailureInfo,
      ) => void)
    | undefined;
  private readonly stderrTailBytes: number;
  private readonly running = new Map<string, RunningBuild>();
  /** Source ids whose running child was cancelled — cleared on settle. */
  private readonly cancelling = new Set<string>();
  private readonly queue: string[] = [];
  /** Per-source backoff caps `request()` to one spawn per cooldown window. */
  private readonly lastFailureAt = new Map<string, number>();
  private shuttingDown = false;

  constructor(options: IndexBuildPoolOptions) {
    this.concurrency = options.concurrency;
    this.spawnChild = options.spawn;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
    this.sweepTempDir = options.sweepTempDir;
    this.onSettle = options.onSettle;
    this.stderrTailBytes = options.stderrTailBytes ?? 4 * 1024;
  }

  /**
   * SIGTERMs the running child and sweeps its temp dir on exit. Cancel is
   * not a failure — no cooldown is recorded, so a follow-up can spawn
   * immediately. No-op for unknown ids or sources with no live child.
   */
  cancel(sourceId: string): void {
    const queueIndex = this.queue.indexOf(sourceId);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
      return;
    }
    const running = this.running.get(sourceId);
    if (running === undefined) return;
    this.cancelling.add(sourceId);
    running.child.kill('SIGTERM');
  }

  /** Idempotent — a source already building or queued is left alone. */
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

  isBuilding(sourceId: string): boolean {
    return this.running.has(sourceId) || this.queue.includes(sourceId);
  }

  isInCooldown(sourceId: string): boolean {
    return this.checkCooldown(sourceId);
  }

  /** Clears the post-failure cooldown — called by Retry to bypass the backoff. */
  forgetFailure(sourceId: string): void {
    this.lastFailureAt.delete(sourceId);
  }

  private checkCooldown(sourceId: string): boolean {
    const at = this.lastFailureAt.get(sourceId);
    if (at === undefined) return false;
    return this.now() - at < this.cooldownMs;
  }

  async whenIdle(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.all(
        [...this.running.values()].map((build) => build.exited),
      );
    }
  }

  /** SIGTERMs every running child and resolves once they have exited. */
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
    // Capped rolling stderr tail — surfaced only on failure.
    let stderrTail = '';
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        const text =
          typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        stderrTail =
          stderrTail.length + text.length <= this.stderrTailBytes
            ? stderrTail + text
            : (stderrTail + text).slice(-this.stderrTailBytes);
      });
    }
    let exitCode: number | null | undefined = undefined;
    let spawnErrorMessage: string | undefined = undefined;
    // A spawn failure (ENOENT) emits `'error'` and never `'exit'` — without
    // the error handler the slot would never free. Both paths funnel into
    // idempotent cleanup via `settled`.
    let settled = false;
    const settle = (failed: boolean): void => {
      if (settled) return;
      settled = true;
      this.running.delete(sourceId);
      const cancelled = this.cancelling.delete(sourceId);
      let outcome: 'success' | 'failure' | 'cancel';
      let info: BuildFailureInfo | undefined;
      if (cancelled) {
        // Cancel is a user decision, not a broken build — skip cooldown
        // bookkeeping so a follow-up can spawn immediately, and sweep the
        // temp dir the killed child left behind.
        this.lastFailureAt.delete(sourceId);
        if (this.sweepTempDir) {
          void this.sweepTempDir(sourceId);
        }
        outcome = 'cancel';
      } else if (failed) {
        this.lastFailureAt.set(sourceId, this.now());
        outcome = 'failure';
        info = {
          kind: 'index-build-failed',
          message: buildFailureMessage(exitCode, spawnErrorMessage),
        };
        if (stderrTail.length > 0) info.details = stderrTail;
      } else {
        this.lastFailureAt.delete(sourceId);
        outcome = 'success';
      }
      markExited();
      this.onSettle?.(sourceId, outcome, info);
      if (this.shuttingDown) return;
      const next = this.queue.shift();
      if (next !== undefined) this.start(next);
    };
    // `null` exit code = signalled; treated as failure since no manifest got written.
    child.on('exit', (code) => {
      exitCode = code;
      settle(code !== 0);
    });
    child.on('error', (err) => {
      spawnErrorMessage = err.message;
      settle(true);
    });
  }
}

interface RunningBuild {
  child: BuildChild;
  /** Resolves when this build child fires `exit`. */
  exited: Promise<void>;
}

// Spawn error wins over exit code (spawn path never reaches `exit`).
// `null` collapses to `'signalled'` so the chip doesn't read `'exit code null'`.
function buildFailureMessage(
  exitCode: number | null | undefined,
  spawnErrorMessage: string | undefined,
): string {
  if (spawnErrorMessage !== undefined) return spawnErrorMessage;
  if (exitCode === null || exitCode === undefined) return 'signalled';
  return `exit code ${exitCode}`;
}
