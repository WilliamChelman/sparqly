import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GRAPH_STRATEGIES } from 'core';
import {
  blockSchemaFromFields,
  defaultsFromFields,
  type FieldDescriptor,
} from './field';

const graphStrategyField: FieldDescriptor = {
  key: 'graphStrategy',
  schema: z.enum(GRAPH_STRATEGIES),
  default: 'default',
};

const sourcesField: FieldDescriptor = {
  key: 'sources',
  schema: z.union([z.string(), z.array(z.string()).min(1)]),
};

describe('blockSchemaFromFields', () => {
  it('makes every field optional and rejects unknown graphStrategy', () => {
    const schema = blockSchemaFromFields([graphStrategyField, sourcesField]);
    const ok = schema.safeParse({ sources: 'a/*.ttl' });
    expect(ok.success).toBe(true);

    const bad = schema.safeParse({ graphStrategy: 'bogus' });
    expect(bad.success).toBe(false);
  });

  it('accepts the empty object (all fields optional)', () => {
    const schema = blockSchemaFromFields([graphStrategyField, sourcesField]);
    const r = schema.safeParse({});
    expect(r.success).toBe(true);
  });
});

describe('defaultsFromFields', () => {
  it('returns only fields that declare a default', () => {
    const out = defaultsFromFields([graphStrategyField, sourcesField]);
    expect(out).toEqual({ graphStrategy: 'default' });
  });
});
