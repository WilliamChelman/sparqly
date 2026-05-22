import { describe, expect, it } from 'vitest';
import type { BuildChild } from 'server';
import { makeSpawnIndexBuild, type SpawnFn } from './serve-index-spawn';

const noopChild: BuildChild = { on: () => undefined, kill: () => undefined };

describe('makeSpawnIndexBuild', () => {
  it('spawns `<cliEntry> index <sourceId>` and returns the child', () => {
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
        args: ['/app/cli/main.js', 'index', 'people'],
      },
    ]);
    expect(child).toBe(noopChild);
  });

  it('inherits the child stderr so build logs surface in serve output', () => {
    let stdio: unknown;
    const spawn: SpawnFn = (_command, _args, options) => {
      stdio = options.stdio;
      return noopChild;
    };

    makeSpawnIndexBuild({ cliEntry: '/app/cli/main.js', spawn })('people');

    expect(stdio).toEqual(['ignore', 'ignore', 'inherit']);
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
