import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GRAPH_MODES } from 'core';
import {
  blockSchemaFromFields,
  defaultsFromFields,
  type FieldDescriptor,
} from './field';

const graphModeField: FieldDescriptor = {
  key: 'graphMode',
  schema: z.enum(GRAPH_MODES),
  default: 'preserve',
};

const sourcesField: FieldDescriptor = {
  key: 'sources',
  schema: z.union([z.string(), z.array(z.string()).min(1)]),
};

describe('blockSchemaFromFields', () => {
  it('makes every field optional and rejects unknown graphMode', () => {
    const schema = blockSchemaFromFields([graphModeField, sourcesField]);
    const ok = schema.safeParse({ sources: 'a/*.ttl' });
    expect(ok.success).toBe(true);

    const bad = schema.safeParse({ graphMode: 'bogus' });
    expect(bad.success).toBe(false);
  });

  it('accepts the empty object (all fields optional)', () => {
    const schema = blockSchemaFromFields([graphModeField, sourcesField]);
    const r = schema.safeParse({});
    expect(r.success).toBe(true);
  });
});

describe('defaultsFromFields', () => {
  it('returns only fields that declare a default', () => {
    const out = defaultsFromFields([graphModeField, sourcesField]);
    expect(out).toEqual({ graphMode: 'preserve' });
  });
});
