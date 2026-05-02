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

  it('registers a nested subcommand when spec.name contains a space', async () => {
    let received: Record<string, unknown> | undefined;
    const idField: FieldDescriptor = {
      key: 'id',
      schema: z.string().optional(),
    };
    const spec: CommandSpec<Record<string, unknown>> = {
      name: 'cache list',
      description: 'list cached views',
      fields: [idField],
      handler: (config) => {
        received = config as Record<string, unknown>;
      },
      exitCode: () => 1,
    };

    const program = makeProgram();
    registerSpec(program, spec, { env: {}, cwd: process.cwd() });
    await program.parseAsync(['cache', 'list'], { from: 'user' });

    expect(received).toEqual({});
  });

  it('two specs sharing the same parent register as siblings under the same parent', async () => {
    const calls: string[] = [];
    const idField: FieldDescriptor = {
      key: 'id',
      schema: z.string().optional(),
    };
    const listSpec: CommandSpec<Record<string, unknown>> = {
      name: 'cache list',
      description: 'list',
      fields: [idField],
      handler: () => {
        calls.push('list');
      },
      exitCode: () => 1,
    };
    const clearSpec: CommandSpec<Record<string, unknown>> = {
      name: 'cache clear',
      description: 'clear',
      fields: [idField],
      positionals: [{ field: 'id', name: 'id' }],
      handler: (config) => {
        calls.push(`clear:${(config as { id?: string }).id ?? ''}`);
      },
      exitCode: () => 1,
    };

    const program = makeProgram();
    registerSpec(program, listSpec, { env: {}, cwd: process.cwd() });
    registerSpec(program, clearSpec, { env: {}, cwd: process.cwd() });
    await program.parseAsync(['cache', 'list'], { from: 'user' });
    await program.parseAsync(['cache', 'clear', 'foo'], { from: 'user' });

    expect(calls).toEqual(['list', 'clear:foo']);
  });

  it('whitespace inside a positional value reaches the handler intact (top-level spec)', async () => {
    let received: Record<string, unknown> | undefined;
    const labelField: FieldDescriptor = {
      key: 'label',
      schema: z.string(),
    };
    const spec: CommandSpec<Record<string, unknown>> = {
      name: 'demo',
      description: 'demo',
      fields: [labelField],
      positionals: [{ field: 'label', name: 'label' }],
      handler: (config) => {
        received = config as Record<string, unknown>;
      },
      exitCode: () => 1,
    };

    const program = makeProgram();
    registerSpec(program, spec, { env: {}, cwd: process.cwd() });
    await program.parseAsync(['demo', 'hello   world'], { from: 'user' });

    expect(received?.label).toBe('hello   world');
  });

  it('whitespace inside a flag value reaches the handler intact (top-level spec)', async () => {
    let received: Record<string, unknown> | undefined;
    const labelField: FieldDescriptor = {
      key: 'label',
      schema: z.string(),
      flags: [{ spec: '--label <text>', description: 'label' }],
    };
    const spec: CommandSpec<Record<string, unknown>> = {
      name: 'demo',
      description: 'demo',
      fields: [labelField],
      handler: (config) => {
        received = config as Record<string, unknown>;
      },
      exitCode: () => 1,
    };

    const program = makeProgram();
    registerSpec(program, spec, { env: {}, cwd: process.cwd() });
    await program.parseAsync(['demo', '--label', 'hello   world'], {
      from: 'user',
    });

    expect(received?.label).toBe('hello   world');
  });

  it('whitespace inside a positional value reaches a nested subcommand handler intact', async () => {
    let received: Record<string, unknown> | undefined;
    const idField: FieldDescriptor = {
      key: 'id',
      schema: z.string().optional(),
    };
    const spec: CommandSpec<Record<string, unknown>> = {
      name: 'cache clear',
      description: 'clear',
      fields: [idField],
      positionals: [{ field: 'id', name: 'id' }],
      handler: (config) => {
        received = config as Record<string, unknown>;
      },
      exitCode: () => 1,
    };

    const program = makeProgram();
    registerSpec(program, spec, { env: {}, cwd: process.cwd() });
    await program.parseAsync(['cache', 'clear', 'id with spaces'], {
      from: 'user',
    });

    expect(received?.id).toBe('id with spaces');
  });

  it('whitespace inside a flag value reaches a nested subcommand handler intact', async () => {
    let received: Record<string, unknown> | undefined;
    const cacheDirField: FieldDescriptor = {
      key: 'cacheDir',
      schema: z.string(),
      flags: [{ spec: '--cache-dir <path>', description: 'cache dir' }],
    };
    const spec: CommandSpec<Record<string, unknown>> = {
      name: 'cache list',
      description: 'list',
      fields: [cacheDirField],
      handler: (config) => {
        received = config as Record<string, unknown>;
      },
      exitCode: () => 1,
    };

    const program = makeProgram();
    registerSpec(program, spec, { env: {}, cwd: process.cwd() });
    await program.parseAsync(
      ['cache', 'list', '--cache-dir', '/tmp/dir with space'],
      { from: 'user' },
    );

    expect(received?.cacheDir).toBe('/tmp/dir with space');
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

  describe('@id reference resolution', () => {
    const richSourcesField: FieldDescriptor = {
      key: 'sources',
      schema: z.union([
        z.union([
          z.string(),
          z
            .object({
              id: z.string().optional(),
              glob: z.string().optional(),
              endpoint: z.string().optional(),
              graph: z.string().optional(),
            })
            .strict(),
        ]),
        z
          .array(
            z.union([
              z.string(),
              z
                .object({
                  id: z.string().optional(),
                  glob: z.string().optional(),
                  endpoint: z.string().optional(),
                  graph: z.string().optional(),
                })
                .strict(),
            ]),
          )
          .min(1),
      ]),
      flags: [
        {
          spec: '-s, --sources <glob>',
          description: 'sources (repeatable)',
          parse: (value, prev) => [
            ...((prev as string[] | undefined) ?? []),
            value,
          ],
        },
      ],
    };

    function makeSpec(
      handler: (c: unknown) => void,
    ): CommandSpec<Record<string, unknown>> {
      return {
        name: 'demo',
        description: 'demo',
        fields: [richSourcesField],
        positionals: [{ field: 'sources', name: 'glob' }],
        handler,
        exitCode: () => 1,
      };
    }

    it('inlines a CLI @id against the file registry, before Zod', async () => {
      let received: Record<string, unknown> | undefined;
      const spec = makeSpec((c) => {
        received = c as Record<string, unknown>;
      });
      const program = makeProgram();
      registerSpec(program, spec, {
        env: {},
        cwd: '/cwd',
        loadFile: async () => ({
          data: {
            sources: [
              { id: 'main', glob: 'data/*.ttl', graph: 'urn:my:graph' },
            ],
          },
          filepath: '/cfg.yaml',
        }),
      });
      await program.parseAsync(
        ['demo', '--config', '/cfg.yaml', '-s', '@main'],
        { from: 'user' },
      );
      expect(received?.sources).toEqual([
        { glob: 'data/*.ttl', graph: 'urn:my:graph' },
      ]);
    });

    it('errors with "no config loaded" when an @id is given without a config file', async () => {
      const errors: string[] = [];
      const stderr = { write: (chunk: string) => errors.push(chunk) };
      const spec = makeSpec(() => undefined);
      const program = makeProgram();
      registerSpec(program, spec, {
        env: {},
        cwd: '/cwd',
        stderr,
      });
      await program.parseAsync(['demo', '@main'], { from: 'user' });
      expect(errors.join('')).toMatch(
        /cannot resolve @id reference "@main".*no config file is loaded/,
      );
    });

    it('resolves @id inside file sources when no CLI override is given', async () => {
      let received: Record<string, unknown> | undefined;
      const spec = makeSpec((c) => {
        received = c as Record<string, unknown>;
      });
      const program = makeProgram();
      registerSpec(program, spec, {
        env: {},
        cwd: '/cwd',
        loadFile: async () => ({
          data: {
            sources: [
              { id: 'vocab', glob: 'vocab/*.ttl' },
              '@vocab',
            ],
          },
          filepath: '/cfg.yaml',
        }),
      });
      await program.parseAsync(['demo', '--config', '/cfg.yaml'], {
        from: 'user',
      });
      expect(received?.sources).toEqual([
        { id: 'vocab', glob: 'vocab/*.ttl' },
        { glob: 'vocab/*.ttl' },
      ]);
    });

    it('errors with the list of defined ids on an unknown @id reference', async () => {
      const errors: string[] = [];
      const stderr = { write: (chunk: string) => errors.push(chunk) };
      const spec = makeSpec(() => undefined);
      const program = makeProgram();
      registerSpec(program, spec, {
        env: {},
        cwd: '/cwd',
        stderr,
        loadFile: async () => ({
          data: {
            sources: [
              { id: 'one', glob: 'a/*.ttl' },
              { id: 'two', glob: 'b/*.ttl' },
            ],
          },
          filepath: '/cfg.yaml',
        }),
      });
      await program.parseAsync(
        ['demo', '--config', '/cfg.yaml', '-s', '@three'],
        { from: 'user' },
      );
      expect(errors.join('')).toMatch(
        /unknown @id reference "@three".*@one.*@two/s,
      );
    });

    it('resolves @id after env-var substitution on registry strings (file-loader expands ${VAR} first)', async () => {
      let received: Record<string, unknown> | undefined;
      const spec = makeSpec((c) => {
        received = c as Record<string, unknown>;
      });
      const program = makeProgram();
      registerSpec(program, spec, {
        env: {},
        cwd: '/cwd',
        // file-loader is responsible for env subst; simulate that an
        // already-expanded registry is what reaches the runner.
        loadFile: async () => ({
          data: {
            sources: [{ id: 'main', glob: '/data/expanded/*.ttl' }],
          },
          filepath: '/cfg.yaml',
        }),
      });
      await program.parseAsync(
        ['demo', '--config', '/cfg.yaml', '-s', '@main'],
        { from: 'user' },
      );
      expect(received?.sources).toEqual([
        { glob: '/data/expanded/*.ttl' },
      ]);
    });
  });
});
