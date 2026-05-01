import { z } from 'zod';

export interface FieldFlag {
  readonly spec: string;
  readonly description: string;
  readonly parse?: (value: string, previous: unknown) => unknown;
  readonly attributeName?: string;
  readonly preset?: string;
}

export interface FieldDescriptor {
  readonly key: string;
  readonly schema: z.ZodTypeAny;
  readonly default?: unknown;
  readonly flags?: ReadonlyArray<FieldFlag>;
  readonly env?: string | ReadonlyArray<string>;
  readonly merge?: 'replace' | 'deep';
  readonly shared?: boolean;
}

export function blockSchemaFromFields(
  fields: ReadonlyArray<FieldDescriptor>,
): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) shape[f.key] = f.schema.optional();
  return z.object(shape);
}

export function defaultsFromFields(
  fields: ReadonlyArray<FieldDescriptor>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if ('default' in f) out[f.key] = f.default;
  }
  return out;
}
