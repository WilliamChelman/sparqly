import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
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

describe('runner meta-flags', () => {
  it('--config flag is accepted and routed to file loader', async () => {
    let received: { fileUsed: boolean } | undefined;
    const spec: CommandSpec = {
      name: 'demo',
      description: 'demo',
      fields: [sourcesField],
      handler: (config) => {
        received = { fileUsed: (config as Record<string, unknown>).sources === 'from-file' };
      },
      exitCode: () => 1,
    };

    const program = makeProgram();
    registerSpec(program, spec, {
      env: {},
      cwd: process.cwd(),
      loadFile: async (configPath) => {
        expect(configPath).toBe('/tmp/explicit.yaml');
        return { data: { sources: 'from-file' }, filepath: configPath };
      },
    });
    await program.parseAsync(
      ['demo', '--config', '/tmp/explicit.yaml'],
      { from: 'user' },
    );

    expect(received?.fileUsed).toBe(true);
  });
});
