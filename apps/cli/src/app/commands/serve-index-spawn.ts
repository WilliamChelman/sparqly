import { spawn as nodeSpawn } from 'node:child_process';
import type { BuildChild, SpawnIndexBuild } from 'server';

/** Stderr is piped so the pool can tap a rolling tail; helper tees it to process.stderr. */
export type SpawnFn = (
  command: string,
  args: ReadonlyArray<string>,
  options: { stdio: ['ignore', 'ignore', 'pipe'] },
) => BuildChild;

export interface SpawnIndexBuildOptions {
  /** `process.argv[1]` captured before `main.ts` overwrites it. */
  cliEntry: string;
  nodeBin?: string;
  spawn?: SpawnFn;
}

export function makeSpawnIndexBuild(
  options: SpawnIndexBuildOptions,
): SpawnIndexBuild {
  const nodeBin = options.nodeBin ?? process.execPath;
  const spawn = options.spawn ?? (nodeSpawn as unknown as SpawnFn);
  return (sourceId) => {
    const child = spawn(nodeBin, [options.cliEntry, 'index', sourceId], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    // Tee piped stderr to parent's stderr so build logs still surface live.
    const childWithStderr = child as BuildChild & {
      stderr?: { pipe?: (dest: NodeJS.WritableStream) => unknown } | null;
    };
    if (childWithStderr.stderr && typeof childWithStderr.stderr.pipe === 'function') {
      childWithStderr.stderr.pipe(process.stderr);
    }
    return child;
  };
}
