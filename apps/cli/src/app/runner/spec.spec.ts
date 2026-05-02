import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GRAPH_MODES } from 'core';
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

const graphModeField: FieldDescriptor = {
  key: 'graphMode',
  schema: z.enum(GRAPH_MODES),
  default: 'preserve',
  flags: [
    {
      spec: '--graph-mode <mode>',
      description: 'named-graph mode',
    },
  ],
};

describe('CommandSpec', () => {
  it('composes fields into a usable block schema and defaults', () => {
    const spec: CommandSpec<{ sources?: string | string[]; graphMode?: string }> = {
      name: 'test',
      description: 'test command',
      fields: [sourcesField, graphModeField],
      handler: async () => undefined,
      exitCode: () => 1,
    };

    const schema = blockSchemaFromFields(spec.fields);
    const ok = schema.safeParse({ sources: 'a/*.ttl' });
    expect(ok.success).toBe(true);

    const bad = schema.safeParse({ graphMode: 'bogus' });
    expect(bad.success).toBe(false);

    expect(defaultsFromFields(spec.fields)).toEqual({ graphMode: 'preserve' });
  });

});
