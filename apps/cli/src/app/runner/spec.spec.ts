import { describe, expect, it } from 'vitest';
import { z } from 'zod';
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

const modeField: FieldDescriptor = {
  key: 'mode',
  schema: z.enum(['a', 'b', 'c']),
  default: 'a',
  flags: [
    {
      spec: '--mode <mode>',
      description: 'closed-set mode flag (test fixture)',
    },
  ],
};

describe('CommandSpec', () => {
  it('composes fields into a usable block schema and defaults', () => {
    const spec: CommandSpec<{ sources?: string | string[]; mode?: string }> = {
      name: 'test',
      description: 'test command',
      fields: [sourcesField, modeField],
      handler: async () => undefined,
      exitCode: () => 1,
    };

    const schema = blockSchemaFromFields(spec.fields);
    const ok = schema.safeParse({ sources: 'a/*.ttl' });
    expect(ok.success).toBe(true);

    const bad = schema.safeParse({ mode: 'bogus' });
    expect(bad.success).toBe(false);

    expect(defaultsFromFields(spec.fields)).toEqual({ mode: 'a' });
  });

});
