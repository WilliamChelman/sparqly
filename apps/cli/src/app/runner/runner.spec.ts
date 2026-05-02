import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GRAPH_MODES } from 'core';
import type { FieldDescriptor } from './field';
import { registerSpec } from './runner';
import type { CommandSpec } from './spec';

function makeProgram(): Command {
  return new Command('sparqly').exitOverride();
}

const sourcesField: FieldDescriptor = {
  key: 'sources',
  schema: z.union([z.string(), z.array(z.string()).min(1)]),
  flags: [
    {
      spec: '-s, --sources <glob>',
      description: 'sources glob (repeatable)',
      parse: (value, prev) => [...((prev as string[] | undefined) ?? []), value],
    },
  ],
};

const graphModeField: FieldDescriptor = {
  key: 'graphMode',
  schema: z.enum(GRAPH_MODES),
  default: 'preserve',
  flags: [{ spec: '--graph-mode <mode>', description: 'gm' }],
};

const jsonField: FieldDescriptor = {
  key: 'json',
  schema: z.boolean(),
  default: false,
  flags: [{ spec: '--json', description: 'json' }],
};

describe('registerSpec', () => {
  it('parses argv and calls handler with merged config (defaults + cli)', async () => {
    let received: unknown;
    const spec: CommandSpec<Record<string, unknown>> = {
      name: 'demo',
      description: 'demo',
      fields: [sourcesField, graphModeField, jsonField],
      positionals: [{ field: 'sources', name: 'glob' }],
      handler: (config) => {
        received = config;
      },
      exitCode: () => 1,
    };

    const program = makeProgram();
    registerSpec(program, spec, { env: {}, cwd: process.cwd() });
    await program.parseAsync(
      ['demo', 'a/*.ttl', '--graph-mode', 'forceAll', '--json'],
      { from: 'user' },
    );

    expect(received).toEqual({
      sources: 'a/*.ttl',
      graphMode: 'forceAll',
      json: true,
    });
  });

  it('repeated --sources flag accumulates into an array, beating positional', async () => {
    let received: Record<string, unknown> | undefined;
    const spec: CommandSpec = {
      name: 'demo',
      description: 'demo',
      fields: [sourcesField, graphModeField, jsonField],
      positionals: [{ field: 'sources', name: 'glob' }],
      handler: (config) => {
        received = config as Record<string, unknown>;
      },
      exitCode: () => 1,
    };

    const program = makeProgram();
    registerSpec(program, spec, { env: {}, cwd: process.cwd() });
    await program.parseAsync(
      ['demo', '-s', 'a/*.ttl', '-s', 'b/*.ttl'],
      { from: 'user' },
    );

    expect(received?.sources).toEqual(['a/*.ttl', 'b/*.ttl']);
  });

  it('reads env via SPARQLY_<COMMAND>_<KEY>', async () => {
    let received: Record<string, unknown> | undefined;
    const labelField: FieldDescriptor = {
      key: 'label',
      schema: z.string(),
      env: 'SPARQLY_DEMO_LABEL',
      flags: [{ spec: '--label <text>', description: 'label' }],
    };
    const spec: CommandSpec = {
      name: 'demo',
      description: 'demo',
      fields: [sourcesField, labelField],
      positionals: [{ field: 'sources', name: 'glob' }],
      handler: (config) => {
        received = config as Record<string, unknown>;
      },
      exitCode: () => 1,
    };

    const program = makeProgram();
    registerSpec(program, spec, {
      env: { SPARQLY_DEMO_LABEL: 'from-env' },
      cwd: process.cwd(),
    });
    await program.parseAsync(['demo', 'a/*.ttl'], { from: 'user' });

    expect(received?.label).toBe('from-env');
  });

  describe('config file resolution', () => {
    function makeSpec(handler: (c: unknown) => void): CommandSpec<Record<string, unknown>> {
      return {
        name: 'demo',
        description: 'demo',
        fields: [sourcesField],
        positionals: [{ field: 'sources', name: 'glob' }],
        handler,
        exitCode: () => 1,
      };
    }

    it('passes --config <path> through to the file loader', async () => {
      let received: string | undefined;
      const spec = makeSpec(() => undefined);
      const program = makeProgram();
      registerSpec(program, spec, {
        env: {},
        cwd: '/cwd',
        loadFile: async (configPath) => {
          received = configPath;
          return { data: {}, filepath: null };
        },
      });
      await program.parseAsync(['demo', '--config', '/explicit.yaml'], {
        from: 'user',
      });
      expect(received).toBe('/explicit.yaml');
    });

    it('falls back to SPARQLY_CONFIG env var when --config is not given', async () => {
      let received: string | undefined;
      const spec = makeSpec(() => undefined);
      const program = makeProgram();
      registerSpec(program, spec, {
        env: { SPARQLY_CONFIG: '/from-env.yaml' },
        cwd: '/cwd',
        loadFile: async (configPath) => {
          received = configPath;
          return { data: {}, filepath: null };
        },
      });
      await program.parseAsync(['demo'], { from: 'user' });
      expect(received).toBe('/from-env.yaml');
    });

    it('--config overrides SPARQLY_CONFIG', async () => {
      let received: string | undefined;
      const spec = makeSpec(() => undefined);
      const program = makeProgram();
      registerSpec(program, spec, {
        env: { SPARQLY_CONFIG: '/from-env.yaml' },
        cwd: '/cwd',
        loadFile: async (configPath) => {
          received = configPath;
          return { data: {}, filepath: null };
        },
      });
      await program.parseAsync(['demo', '--config', '/explicit.yaml'], {
        from: 'user',
      });
      expect(received).toBe('/explicit.yaml');
    });

    it('does not invoke the file loader when neither --config nor SPARQLY_CONFIG is set', async () => {
      let called = false;
      const spec = makeSpec(() => undefined);
      const program = makeProgram();
      registerSpec(program, spec, {
        env: {},
        cwd: '/cwd',
        loadFile: async () => {
          called = true;
          return { data: {}, filepath: null };
        },
      });
      await program.parseAsync(['demo', 'a/*.ttl'], { from: 'user' });
      expect(called).toBe(false);
    });
  });
});
