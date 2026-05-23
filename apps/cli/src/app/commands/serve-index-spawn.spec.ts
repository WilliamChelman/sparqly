import { describe, expect, it } from 'vitest';
import type { BuildChild } from 'server';
import { makeSpawnIndexBuild, type SpawnFn } from './serve-index-spawn';

const noopChild: BuildChild = { on: () => undefined, kill: () => undefined };

describe('makeSpawnIndexBuild', () => {
  it('spawns `<cliEntry> index <sourceId> --force` and returns the child (#362)', () => {
    const calls: { command: string; args: ReadonlyArray<string> }[] = [];
    const spawn: SpawnFn = (command, args) => {
      calls.push({ command, args });
      return noopChild;
    };

    const spawnIndexBuild = makeSpawnIndexBuild({
      cliEntry: '/app/cli/main.js',
      nodeBin: '/usr/bin/node',
      spawn,
    });
    const child = spawnIndexBuild('people');

    expect(calls).toEqual([
      {
        command: '/usr/bin/node',
        args: ['/app/cli/main.js', 'index', 'people', '--force'],
      },
    ]);
    expect(child).toBe(noopChild);
  });

  it('pipes the child stderr so the pool can capture a failure tail and the helper mirrors it to process.stderr (#360)', () => {
    let stdio: unknown;
    const piped: NodeJS.WritableStream[] = [];
    const childWithStderr: BuildChild = {
      on: () => undefined,
      kill: () => undefined,
      stderr: {
        on: () => undefined,
        pipe: (dest: NodeJS.WritableStream) => {
          piped.push(dest);
          return dest;
        },
      } as unknown as BuildChild['stderr'],
    };
    const spawn: SpawnFn = (_command, _args, options) => {
      stdio = options.stdio;
      return childWithStderr;
    };

    makeSpawnIndexBuild({ cliEntry: '/app/cli/main.js', spawn })('people');

    expect(stdio).toEqual(['ignore', 'ignore', 'pipe']);
    expect(piped).toEqual([process.stderr]);
  });

  it('defaults the node binary to the running process executable', () => {
    let command: string | undefined;
    const spawn: SpawnFn = (cmd) => {
      command = cmd;
      return noopChild;
    };

    makeSpawnIndexBuild({ cliEntry: '/app/cli/main.js', spawn })('people');

    expect(command).toBe(process.execPath);
  });
});
