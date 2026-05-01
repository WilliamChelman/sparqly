import type { z } from 'zod';
import type { FieldDescriptor } from './field';

export interface PositionalDescriptor {
  readonly field: string;
  readonly name: string;
  readonly required?: boolean;
  readonly variadic?: boolean;
}

export interface CommandSpec<TConfig = Record<string, unknown>> {
  readonly name: string;
  readonly description: string;
  readonly fields: ReadonlyArray<FieldDescriptor>;
  readonly positionals?: ReadonlyArray<PositionalDescriptor>;
  readonly handler: (config: TConfig) => Promise<void> | void;
  readonly exitCode: (
    error: unknown,
    context?: { readonly rawConfig?: Record<string, unknown> },
  ) => number;
  readonly refine?: (schema: z.ZodTypeAny) => z.ZodTypeAny;
}
