import type { SparqlyLogger } from 'common';

export interface ShutdownDeps {
  /** Releases index locks and SIGTERMs in-flight build children. */
  close: () => Promise<void>;
  /** process.exit (injectable for tests). */
  exit: (code: number) => void;
  /** Optional logger for shutdown failures. */
  logger?: SparqlyLogger;
  /**
   * Force-exit timeout in ms. If `close()` doesn't settle within this window,
   * the handler still exits with code 1 so a hung close can't pin the process.
   * Defaults to 10_000.
   */
  forceExitMs?: number;
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (id: unknown) => void;
}

/**
 * Wraps `created.close()` in a one-shot signal handler that:
 *   - exits 0 once close settles cleanly,
 *   - catches a rejection and exits 1 (instead of leaving an unhandled promise),
 *   - force-exits 1 if close hangs past `forceExitMs`.
 */
export function makeShutdownHandler(deps: ShutdownDeps): () => void {
  const scheduleTimer = deps.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = deps.clearTimeoutFn ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const forceExitMs = deps.forceExitMs ?? 10_000;

  let triggered = false;
  return () => {
    if (triggered) return;
    triggered = true;

    const timer = scheduleTimer(() => {
      deps.logger?.error('graceful shutdown timed out — forcing exit', {
        forceExitMs,
      });
      deps.exit(1);
    }, forceExitMs);

    deps.close().then(
      () => {
        clearTimer(timer);
        deps.exit(0);
      },
      (err: unknown) => {
        clearTimer(timer);
        deps.logger?.error('graceful shutdown failed', {
          err:
            err instanceof Error
              ? { name: err.name, message: err.message }
              : err,
        });
        deps.exit(1);
      },
    );
  };
}
