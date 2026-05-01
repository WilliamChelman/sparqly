import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { FieldDescriptor } from './field';
import { registerSpec } from './runner';
import type { CommandSpec } from './spec';

const sourcesField: FieldDescriptor = {
  key: 'sources',
  schema: z.string(),
  flags: [{ spec: '-s, --sources <glob>', description: 'sources' }],
};

function makeProgram(): Command {
  return new Command('sparqly').exitOverride();
}

describe('runner error mapping', () => {
  let stderrChunks: string[];
  let originalExitCode: number | undefined;
  beforeEach(() => {
    stderrChunks = [];
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('writes "error: <message>" to stderr and sets exitCode from spec.exitCode', async () => {
    const spec: CommandSpec = {
      name: 'demo',
      description: 'demo',
      fields: [sourcesField],
      handler: async () => {
        throw new Error('boom');
      },
      exitCode: () => 7,
    };

    const program = makeProgram();
    registerSpec(program, spec, {
      env: {},
      cwd: process.cwd(),
      stderr: { write: (c: string) => stderrChunks.push(c) },
    });

    await program.parseAsync(['demo', '-s', 'a/*.ttl'], { from: 'user' });

    expect(stderrChunks.join('')).toBe('error: boom\n');
    expect(process.exitCode).toBe(7);
  });

  it('passes the thrown error to spec.exitCode for context-sensitive codes', async () => {
    let captured: unknown;
    const spec: CommandSpec = {
      name: 'demo',
      description: 'demo',
      fields: [sourcesField],
      handler: async () => {
        const e = new Error('mismatch');
        (e as Error & { kind?: string }).kind = 'mismatch';
        throw e;
      },
      exitCode: (err) => {
        captured = err;
        return (err as { kind?: string })?.kind === 'mismatch' ? 1 : 2;
      },
    };

    const program = makeProgram();
    registerSpec(program, spec, {
      env: {},
      cwd: process.cwd(),
      stderr: { write: (c: string) => stderrChunks.push(c) },
    });

    await program.parseAsync(['demo', '-s', 'a/*.ttl'], { from: 'user' });

    expect((captured as Error)?.message).toBe('mismatch');
    expect(process.exitCode).toBe(1);
  });
});
