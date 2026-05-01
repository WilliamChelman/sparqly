import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GRAPH_STRATEGIES } from 'core';
import { blockSchemaFromFields, defaultsFromFields } from './field';
import type { FieldDescriptor } from './field';
import type { CommandSpec } from './spec';

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

const graphStrategyField: FieldDescriptor = {
  key: 'graphStrategy',
  schema: z.enum(GRAPH_STRATEGIES),
  default: 'default',
  flags: [
    {
      spec: '--graph-strategy <strategy>',
      description: 'named-graph strategy',
    },
  ],
};

describe('CommandSpec', () => {
  it('composes fields into a usable block schema and defaults', () => {
    const spec: CommandSpec<{ sources?: string | string[]; graphStrategy?: string }> = {
      name: 'test',
      description: 'test command',
      fields: [sourcesField, graphStrategyField],
      handler: async () => {},
      exitCode: () => 1,
    };

    const schema = blockSchemaFromFields(spec.fields);
    const ok = schema.safeParse({ sources: 'a/*.ttl' });
    expect(ok.success).toBe(true);

    const bad = schema.safeParse({ graphStrategy: 'bogus' });
    expect(bad.success).toBe(false);

    expect(defaultsFromFields(spec.fields)).toEqual({ graphStrategy: 'default' });
  });

  it('declares fileBlockName defaulting to spec.name when absent', () => {
    const spec: CommandSpec = {
      name: 'hash',
      description: 'hash',
      fields: [],
      handler: async () => {},
      exitCode: () => 1,
    };
    expect(spec.fileBlockName ?? spec.name).toBe('hash');
  });
});
