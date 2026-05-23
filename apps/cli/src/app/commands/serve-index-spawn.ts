import { spawn as nodeSpawn } from 'node:child_process';
import type { BuildChild, SpawnIndexBuild } from 'server';

/**
 * The slice of `child_process.spawn` {@link makeSpawnIndexBuild} drives —
 * narrowed so a test can inject a synthetic spawn. Node's real `spawn`
 * satisfies it: its `ChildProcess` return structurally satisfies
 * {@link BuildChild}.
 *
 * Stderr is piped (rather than inherited) so the pool can tap a rolling tail
 * for the Sources page failure surface (#360); the spawn helper still mirrors
 * those bytes onto `process.stderr` so the operator sees live build progress
 * in `serve`'s own output exactly as before.
 */
export type SpawnFn = (
  command: string,
  args: ReadonlyArray<string>,
  options: { stdio: ['ignore', 'ignore', 'pipe'] },
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
 * its stderr piped — the pool's tail capture taps the same stream the helper
 * mirrors to `process.stderr`, so progress logs still surface in `serve`'s own
 * output while a build failure carries a stderr tail onto the Sources page.
 */
export function makeSpawnIndexBuild(
  options: SpawnIndexBuildOptions,
): SpawnIndexBuild {
  const nodeBin = options.nodeBin ?? process.execPath;
  const spawn = options.spawn ?? (nodeSpawn as unknown as SpawnFn);
  return (sourceId) => {
    const child = spawn(nodeBin, [options.cliEntry, 'index', sourceId], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    // Tee the piped stderr back onto the parent's stderr — preserves the
    // pre-#360 "I see the build's logs in `serve`'s output" property while
    // letting the pool's tap on the same stream collect a tail for the
    // Sources page row.
    const childWithStderr = child as BuildChild & {
      stderr?: { pipe?: (dest: NodeJS.WritableStream) => unknown } | null;
    };
    if (childWithStderr.stderr && typeof childWithStderr.stderr.pipe === 'function') {
      childWithStderr.stderr.pipe(process.stderr);
    }
    return child;
  };
}
