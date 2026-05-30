import type { WorkerOptions } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import type { QueryWorkerHandle } from 'server';
import { makeSpawnQueryWorker } from './serve-query-worker-spawn';

/** Captures the args the factory passes to the real `Worker` constructor so a
 * test can assert what `resourceLimits`/`workerData` the worker is spawned with,
 * without standing up a real thread. */
function capturingCreateWorker(): {
  create: (entry: string, options: WorkerOptions) => QueryWorkerHandle;
  calls: Array<{ entry: string; options: WorkerOptions }>;
} {
  const calls: Array<{ entry: string; options: WorkerOptions }> = [];
  return {
    calls,
    create: (entry, options) => {
      calls.push({ entry, options });
      return {} as QueryWorkerHandle;
    },
  };
}

describe('makeSpawnQueryWorker — resourceLimits OOM ceiling (ADR-0050, #389)', () => {
  it('spawns the worker with maxOldGenerationSizeMb as its old-generation ceiling', () => {
    const { create, calls } = capturingCreateWorker();
    const spawn = makeSpawnQueryWorker({
      cliEntry: '/cli.js',
      maxOldGenerationSizeMb: 256,
      createWorker: create,
    });

    spawn();

    expect(calls[0].entry).toBe('/cli.js');
    expect(calls[0].options.resourceLimits?.maxOldGenerationSizeMb).toBe(256);
  });

  it('omits resourceLimits when no ceiling is configured (worker default applies)', () => {
    const { create, calls } = capturingCreateWorker();
    const spawn = makeSpawnQueryWorker({
      cliEntry: '/cli.js',
      createWorker: create,
    });

    spawn();

    expect(calls[0].options.resourceLimits).toBeUndefined();
  });

  it('still passes the query-worker role and resident budget in workerData', () => {
    const { create, calls } = capturingCreateWorker();
    const spawn = makeSpawnQueryWorker({
      cliEntry: '/cli.js',
      maxResidentQuads: 1_000_000,
      maxOldGenerationSizeMb: 256,
      createWorker: create,
    });

    spawn();

    expect(calls[0].options.workerData).toEqual({
      sparqlyRole: 'query-worker',
      maxResidentQuads: 1_000_000,
    });
  });
});
