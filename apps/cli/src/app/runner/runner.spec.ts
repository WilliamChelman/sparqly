import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
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

const modeField: FieldDescriptor = {
  key: 'mode',
  schema: z.enum(['a', 'b', 'c']),
  default: 'a',
  flags: [{ spec: '--mode <mode>', description: 'closed-set mode (test fixture)' }],
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
      fields: [sourcesField, modeField, jsonField],
      positionals: [{ field: 'sources', name: 'glob' }],
      handler: (config) => {
        received = config;
      },
      exitCode: () => 1,
    };

    const program = makeProgram();
    registerSpec(program, spec, { env: {}, cwd: process.cwd() });
    await program.parseAsync(
      ['demo', 'a/*.ttl', '--mode', 'b', '--json'],
      { from: 'user' },
    );

    expect(received).toEqual({
      sources: 'a/*.ttl',
      mode: 'b',
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
      fields: [sourcesField, modeField, jsonField],
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

    it('uses ctx.discoverConfig when no explicit config is supplied', async () => {
      let received: string | undefined;
      const spec = makeSpec(() => undefined);
      const program = makeProgram();
      registerSpec(program, spec, {
        env: {},
        cwd: '/proj/sub',
        discoverConfig: (cwd) => {
          expect(cwd).toBe('/proj/sub');
          return '/proj/sparqly.config.yaml';
        },
        loadFile: async (configPath) => {
          received = configPath;
          return { data: {}, filepath: configPath };
        },
      });
      await program.parseAsync(['demo'], { from: 'user' });
      expect(received).toBe('/proj/sparqly.config.yaml');
    });

    it('--no-config opts out of auto-discovery', async () => {
      let discoverCalled = false;
      let loadCalled = false;
      const spec = makeSpec(() => undefined);
      const program = makeProgram();
      registerSpec(program, spec, {
        env: {},
        cwd: '/proj/sub',
        discoverConfig: () => {
          discoverCalled = true;
          return '/proj/sparqly.config.yaml';
        },
        loadFile: async () => {
          loadCalled = true;
          return { data: {}, filepath: null };
        },
      });
      await program.parseAsync(['demo', '--no-config'], { from: 'user' });
      expect(discoverCalled).toBe(false);
      expect(loadCalled).toBe(false);
    });

    it('treats empty SPARQLY_CONFIG="" as --no-config', async () => {
      let discoverCalled = false;
      let loadCalled = false;
      const spec = makeSpec(() => undefined);
      const program = makeProgram();
      registerSpec(program, spec, {
        env: { SPARQLY_CONFIG: '' },
        cwd: '/proj/sub',
        discoverConfig: () => {
          discoverCalled = true;
          return '/proj/sparqly.config.yaml';
        },
        loadFile: async () => {
          loadCalled = true;
          return { data: {}, filepath: null };
        },
      });
      await program.parseAsync(['demo'], { from: 'user' });
      expect(discoverCalled).toBe(false);
      expect(loadCalled).toBe(false);
    });

    it('--config beats auto-discovery', async () => {
      let received: string | undefined;
      const spec = makeSpec(() => undefined);
      const program = makeProgram();
      registerSpec(program, spec, {
        env: {},
        cwd: '/proj/sub',
        discoverConfig: () => '/proj/sparqly.config.yaml',
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

    it('SPARQLY_CONFIG (non-empty) beats auto-discovery', async () => {
      let received: string | undefined;
      const spec = makeSpec(() => undefined);
      const program = makeProgram();
      registerSpec(program, spec, {
        env: { SPARQLY_CONFIG: '/from-env.yaml' },
        cwd: '/proj/sub',
        discoverConfig: () => '/proj/sparqly.config.yaml',
        loadFile: async (configPath) => {
          received = configPath;
          return { data: {}, filepath: null };
        },
      });
      await program.parseAsync(['demo'], { from: 'user' });
      expect(received).toBe('/from-env.yaml');
    });

    it('skips loadFile when discoverConfig returns null', async () => {
      let loadCalled = false;
      const spec = makeSpec(() => undefined);
      const program = makeProgram();
      registerSpec(program, spec, {
        env: {},
        cwd: '/proj/sub',
        discoverConfig: () => null,
        loadFile: async () => {
          loadCalled = true;
          return { data: {}, filepath: null };
        },
      });
      await program.parseAsync(['demo', 'a/*.ttl'], { from: 'user' });
      expect(loadCalled).toBe(false);
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

  describe('per-command config projection', () => {
    const portField: FieldDescriptor = {
      key: 'port',
      schema: z.coerce.number().int(),
      env: 'SPARQLY_PORT',
      flags: [{ spec: '--port <n>', description: 'p' }],
    };
    const cacheDirField: FieldDescriptor = {
      key: 'cacheDir',
      schema: z.string(),
      env: 'SPARQLY_CACHE_DIR',
      flags: [{ spec: '--cache-dir <p>', description: 'cd' }],
    };
    const baseFmtField: FieldDescriptor = {
      key: 'base',
      schema: z.string(),
    };

    it('serve sees `sources` and the `serve` block flattened to fields', async () => {
      let received: Record<string, unknown> | undefined;
      const spec: CommandSpec<Record<string, unknown>> = {
        name: 'serve',
        description: 's',
        fields: [sourcesField, portField],
        configScope: { sources: true, block: 'serve' },
        handler: (c) => {
          received = c as Record<string, unknown>;
        },
        exitCode: () => 1,
      };
      const program = makeProgram();
      registerSpec(program, spec, {
        env: {},
        cwd: '/cwd',
        loadFile: async () => ({
          data: {
            sources: ['data/*.ttl'],
            serve: { port: 4000 },
          },
          filepath: '/cfg.yaml',
        }),
      });
      await program.parseAsync(['serve', '--config', '/cfg.yaml'], {
        from: 'user',
      });
      expect(received).toMatchObject({
        sources: ['data/*.ttl'],
        port: 4000,
      });
    });

    it('query sees `sources` only — no command-scoped block (and ignores serve/format/cache blocks in the file)', async () => {
      let received: Record<string, unknown> | undefined;
      const spec: CommandSpec<Record<string, unknown>> = {
        name: 'query',
        description: 'q',
        fields: [sourcesField, baseFmtField],
        configScope: { sources: true },
        handler: (c) => {
          received = c as Record<string, unknown>;
        },
        exitCode: () => 1,
      };
      const program = makeProgram();
      registerSpec(program, spec, {
        env: {},
        cwd: '/cwd',
        loadFile: async () => ({
          data: {
            sources: ['data/*.ttl'],
            serve: { port: 4000 },
            format: { base: 'http://example.org/' },
          },
          filepath: '/cfg.yaml',
        }),
      });
      await program.parseAsync(['query', '--config', '/cfg.yaml'], {
        from: 'user',
      });
      expect(received).toEqual({ sources: ['data/*.ttl'] });
    });

    it('format sees the `format` block (deep-merged prefixes survive)', async () => {
      let received: Record<string, unknown> | undefined;
      const prefixesField: FieldDescriptor = {
        key: 'prefixes',
        schema: z.record(z.string(), z.string()),
        merge: 'deep',
      };
      const spec: CommandSpec<Record<string, unknown>> = {
        name: 'format',
        description: 'f',
        fields: [sourcesField, prefixesField, baseFmtField],
        configScope: { sources: true, block: 'format' },
        handler: (c) => {
          received = c as Record<string, unknown>;
        },
        exitCode: () => 1,
      };
      const program = makeProgram();
      registerSpec(program, spec, {
        env: {},
        cwd: '/cwd',
        loadFile: async () => ({
          data: {
            sources: ['data/*.ttl'],
            format: {
              prefixes: { ex: 'http://example.org/' },
              base: 'http://example.org/',
            },
          },
          filepath: '/cfg.yaml',
        }),
      });
      await program.parseAsync(
        ['format', '--config', '/cfg.yaml'],
        { from: 'user' },
      );
      expect(received).toEqual({
        sources: ['data/*.ttl'],
        prefixes: { ex: 'http://example.org/' },
        base: 'http://example.org/',
      });
    });

    it('cache list sees `cache` only — no `sources` — and `cache.dir` projects to field `cacheDir`', async () => {
      let received: Record<string, unknown> | undefined;
      const spec: CommandSpec<Record<string, unknown>> = {
        name: 'cache list',
        description: 'cl',
        fields: [cacheDirField],
        configScope: { sources: false, block: 'cache' },
        handler: (c) => {
          received = c as Record<string, unknown>;
        },
        exitCode: () => 1,
      };
      const program = makeProgram();
      registerSpec(program, spec, {
        env: {},
        cwd: '/cwd',
        loadFile: async () => ({
          data: {
            sources: ['data/*.ttl'],
            cache: { dir: '/abs/.sparqly-cache' },
          },
          filepath: '/cfg.yaml',
        }),
      });
      await program.parseAsync(['cache', 'list', '--config', '/cfg.yaml'], {
        from: 'user',
      });
      expect(received).toEqual({ cacheDir: '/abs/.sparqly-cache' });
    });

    it('SPARQLY_PORT env overrides serve.port from the file', async () => {
      let received: Record<string, unknown> | undefined;
      const spec: CommandSpec<Record<string, unknown>> = {
        name: 'serve',
        description: 's',
        fields: [sourcesField, portField],
        configScope: { sources: true, block: 'serve' },
        handler: (c) => {
          received = c as Record<string, unknown>;
        },
        exitCode: () => 1,
      };
      const program = makeProgram();
      registerSpec(program, spec, {
        env: { SPARQLY_PORT: '9000' },
        cwd: '/cwd',
        loadFile: async () => ({
          data: { sources: ['x'], serve: { port: 4000 } },
          filepath: '/cfg.yaml',
        }),
      });
      await program.parseAsync(['serve', '--config', '/cfg.yaml'], {
        from: 'user',
      });
      expect(received?.port).toBe(9000);
    });

    it('SPARQLY_CACHE_DIR env overrides cache.dir from the file', async () => {
      let received: Record<string, unknown> | undefined;
      const spec: CommandSpec<Record<string, unknown>> = {
        name: 'cache list',
        description: 'cl',
        fields: [cacheDirField],
        configScope: { sources: false, block: 'cache' },
        handler: (c) => {
          received = c as Record<string, unknown>;
        },
        exitCode: () => 1,
      };
      const program = makeProgram();
      registerSpec(program, spec, {
        env: { SPARQLY_CACHE_DIR: '/from/env' },
        cwd: '/cwd',
        loadFile: async () => ({
          data: { cache: { dir: '/from/file' } },
          filepath: '/cfg.yaml',
        }),
      });
      await program.parseAsync(['cache', 'list', '--config', '/cfg.yaml'], {
        from: 'user',
      });
      expect(received?.cacheDir).toBe('/from/env');
    });
  });
});
