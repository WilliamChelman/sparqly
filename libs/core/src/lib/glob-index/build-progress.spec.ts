import { describe, expect, it } from 'vitest';
import { recordingLogger } from '../test/recording-logger';
import { BuildProgress } from './build-progress';

describe('BuildProgress', () => {
  it('emits index-file-start at info when a file begins', () => {
    const { logger, entries } = recordingLogger();
    const progress = new BuildProgress({
      files: [
        { path: '/data/a.ttl', bytes: 40 },
        { path: '/data/b.ttl', bytes: 60 },
      ],
      logger,
    });

    progress.fileStarted(0);

    expect(entries).toEqual([
      {
        level: 'info',
        msg: 'index-file-start',
        fields: { file: '/data/a.ttl', index: 1, total: 2, bytes: 40 },
      },
    ]);
  });

  it('emits index-file-done at info when a file finishes', () => {
    const { logger, entries } = recordingLogger();
    const progress = new BuildProgress({
      files: [
        { path: '/data/a.ttl', bytes: 40 },
        { path: '/data/b.ttl', bytes: 60 },
      ],
      logger,
    });

    progress.fileDone(1);

    expect(entries).toEqual([
      {
        level: 'info',
        msg: 'index-file-done',
        fields: { file: '/data/b.ttl', index: 2, total: 2, bytes: 60 },
      },
    ]);
  });

  it('emits an index-progress heartbeat only once the throttle interval has elapsed', () => {
    const { logger, entries } = recordingLogger();
    let clock = 0;
    const progress = new BuildProgress({
      files: [{ path: '/data/a.ttl', bytes: 100 }],
      logger,
      now: () => clock,
      heartbeatMs: 5000,
    });

    progress.quadsWritten(10_000); // clock 0 — interval not elapsed
    clock = 4999;
    progress.quadsWritten(10_000); // still under 5s since the build started
    clock = 5000;
    progress.quadsWritten(10_000); // 5s elapsed — first heartbeat
    clock = 7000;
    progress.quadsWritten(10_000); // only 2s since the last heartbeat
    clock = 10_000;
    progress.quadsWritten(10_000); // 5s since the last heartbeat — second

    const heartbeats = entries.filter((e) => e.msg === 'index-progress');
    expect(heartbeats).toHaveLength(2);
  });

  it('the index-progress heartbeat carries quads written, elapsed, and rate at info', () => {
    const { logger, entries } = recordingLogger();
    let clock = 0;
    const progress = new BuildProgress({
      files: [{ path: '/data/a.ttl', bytes: 100 }],
      logger,
      now: () => clock,
      heartbeatMs: 5000,
    });

    progress.quadsWritten(30_000);
    clock = 6000;
    progress.quadsWritten(30_000);

    const heartbeat = entries.find((e) => e.msg === 'index-progress');
    expect(heartbeat?.level).toBe('info');
    expect(heartbeat?.fields).toEqual({
      percent: 0,
      quads: 60_000,
      ms: 6000,
      rate: 10_000,
    });
  });

  it('the index-progress percent reflects the byte size of completed files', () => {
    const { logger, entries } = recordingLogger();
    let clock = 0;
    const progress = new BuildProgress({
      files: [
        { path: '/data/a.ttl', bytes: 40 },
        { path: '/data/b.ttl', bytes: 60 },
      ],
      logger,
      now: () => clock,
      heartbeatMs: 5000,
    });

    progress.fileStarted(0);
    progress.fileDone(0); // 40 of 100 total bytes indexed
    clock = 5000;
    progress.quadsWritten(1000);

    const heartbeat = entries.find((e) => e.msg === 'index-progress');
    expect(heartbeat?.fields?.['percent']).toBe(40);
  });
});
