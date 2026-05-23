import type { SparqlyLogger } from 'common';

export interface ShutdownDeps {
  close: () => Promise<void>;
  exit: (code: number) => void;
  logger?: SparqlyLogger;
  /** Defaults to 10_000. */
  forceExitMs?: number;
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (id: unknown) => void;
}

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
