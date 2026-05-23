import { describe, expect, it, vi } from 'vitest';
import type { SparqlyLogger } from 'common';
import { makeShutdownHandler } from './serve-shutdown';

interface ScriptedTimer {
  cb: () => void;
  ms: number;
  cleared: boolean;
}

interface TimerHarness {
  setTimeoutFn: (cb: () => void, ms: number) => ScriptedTimer;
  clearTimeoutFn: (timer: ScriptedTimer) => void;
  fire(timer: ScriptedTimer): void;
  timers: ScriptedTimer[];
}

const makeTimerHarness = (): TimerHarness => {
  const timers: ScriptedTimer[] = [];
  return {
    timers,
    setTimeoutFn: (cb, ms) => {
      const t: ScriptedTimer = { cb, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimeoutFn: (timer) => {
      timer.cleared = true;
    },
    fire(timer) {
      if (!timer.cleared) timer.cb();
    },
  };
};

const makeLoggerSpy = (): {
  logger: SparqlyLogger;
  errors: { msg: string; fields?: Record<string, unknown> }[];
} => {
  const errors: { msg: string; fields?: Record<string, unknown> }[] = [];
  return {
    errors,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: (msg, fields) => errors.push({ msg, fields }),
    },
  };
};

describe('makeShutdownHandler', () => {
  it('exits with code 0 after close() resolves', async () => {
    const exit = vi.fn();
    const timers = makeTimerHarness();
    const handler = makeShutdownHandler({
      close: () => Promise.resolve(),
      exit,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    handler();
    await new Promise((r) => setImmediate(r));

    expect(exit).toHaveBeenCalledWith(0);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('exits with code 1 and logs the error when close() rejects', async () => {
    const exit = vi.fn();
    const timers = makeTimerHarness();
    const log = makeLoggerSpy();
    const boom = new Error('lock release failed');

    const handler = makeShutdownHandler({
      close: () => Promise.reject(boom),
      exit,
      logger: log.logger,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    handler();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(exit).toHaveBeenCalledWith(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0].msg).toMatch(/shutdown/i);
    expect(log.errors[0].fields).toMatchObject({
      err: expect.objectContaining({ message: 'lock release failed' }),
    });
  });

  it('does not raise an unhandled rejection when close() rejects', async () => {
    const exit = vi.fn();
    const timers = makeTimerHarness();
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      seen.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      const handler = makeShutdownHandler({
        close: () => Promise.reject(new Error('boom')),
        exit,
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn,
      });
      handler();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    expect(seen).toEqual([]);
  });

  it('force-exits with code 1 if close() does not settle before forceExitMs', () => {
    const exit = vi.fn();
    const timers = makeTimerHarness();
    const log = makeLoggerSpy();

    const handler = makeShutdownHandler({
      close: () => new Promise(() => undefined), // never settles
      exit,
      logger: log.logger,
      forceExitMs: 5_000,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    handler();
    expect(timers.timers).toHaveLength(1);
    expect(timers.timers[0].ms).toBe(5_000);
    expect(exit).not.toHaveBeenCalled();

    timers.fire(timers.timers[0]);

    expect(exit).toHaveBeenCalledWith(1);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0].msg).toMatch(/timed out|forcing/i);
  });

  it('clears the force-exit timer once close() resolves', async () => {
    const exit = vi.fn();
    const timers = makeTimerHarness();

    const handler = makeShutdownHandler({
      close: () => Promise.resolve(),
      exit,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    handler();
    await new Promise((r) => setImmediate(r));

    expect(timers.timers).toHaveLength(1);
    expect(timers.timers[0].cleared).toBe(true);
  });

  it('is idempotent: a second invocation does not re-trigger close() or exit()', async () => {
    const exit = vi.fn();
    const timers = makeTimerHarness();
    const close = vi.fn(() => Promise.resolve());

    const handler = makeShutdownHandler({
      close,
      exit,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    handler();
    handler();
    await new Promise((r) => setImmediate(r));

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
