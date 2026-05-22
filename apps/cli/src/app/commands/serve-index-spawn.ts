import { spawn as nodeSpawn } from 'node:child_process';
import type { BuildChild, SpawnIndexBuild } from 'server';

/**
 * The slice of `child_process.spawn` {@link makeSpawnIndexBuild} drives —
 * narrowed so a test can inject a synthetic spawn. Node's real `spawn`
 * satisfies it: its `ChildProcess` return structurally satisfies
 * {@link BuildChild}.
 */
export type SpawnFn = (
  command: string,
  args: ReadonlyArray<string>,
  options: { stdio: ['ignore', 'ignore', 'inherit'] },
) => BuildChild;

export interface SpawnIndexBuildOptions {
  /**
   * Absolute path to the CLI entry script — `process.argv[1]` captured before
   * `main.ts` overwrites it with the bare program name.
   */
  cliEntry: string;
  /** Node binary the child runs under. Defaults to `process.execPath`. */
  nodeBin?: string;
  /** Injectable spawn for tests. Defaults to `child_process.spawn`. */
  spawn?: SpawnFn;
}

/**
 * Builds the {@link SpawnIndexBuild} `serve` injects into the server (ADR-0042):
 * each call spawns `node <cliEntry> index <sourceId>` as an isolated child with
 * its stderr inherited, so the build's progress logs surface in `serve`'s own
 * output while its event loop and heap stay separate.
 */
export function makeSpawnIndexBuild(
  options: SpawnIndexBuildOptions,
): SpawnIndexBuild {
  const nodeBin = options.nodeBin ?? process.execPath;
  const spawn = options.spawn ?? (nodeSpawn as unknown as SpawnFn);
  return (sourceId) =>
    spawn(nodeBin, [options.cliEntry, 'index', sourceId], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
}
