import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  blockSchemaFromFields,
  defaultsFromFields,
  type FieldDescriptor,
} from './field';

const modeField: FieldDescriptor = {
  key: 'mode',
  schema: z.enum(['a', 'b', 'c']),
  default: 'a',
};

const sourcesField: FieldDescriptor = {
  key: 'sources',
  schema: z.union([z.string(), z.array(z.string()).min(1)]),
};

describe('blockSchemaFromFields', () => {
  it('makes every field optional and rejects values outside an enum field', () => {
    const schema = blockSchemaFromFields([modeField, sourcesField]);
    const ok = schema.safeParse({ sources: 'a/*.ttl' });
    expect(ok.success).toBe(true);

    const bad = schema.safeParse({ mode: 'bogus' });
    expect(bad.success).toBe(false);
  });

  it('accepts the empty object (all fields optional)', () => {
    const schema = blockSchemaFromFields([modeField, sourcesField]);
    const r = schema.safeParse({});
    expect(r.success).toBe(true);
  });
});

describe('defaultsFromFields', () => {
  it('returns only fields that declare a default', () => {
    const out = defaultsFromFields([modeField, sourcesField]);
    expect(out).toEqual({ mode: 'a' });
  });
});
