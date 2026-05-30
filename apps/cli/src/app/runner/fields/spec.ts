import type { z } from 'zod';
import type { FieldDescriptor } from './field';

export interface PositionalDescriptor {
  readonly field: string;
  readonly name: string;
  readonly required?: boolean;
  readonly variadic?: boolean;
}

export type ProjectConfigBlock = 'serve' | 'format';

export interface ConfigScope {
  /** Whether the command reads the top-level `sources` registry (default: true). */
  readonly sources?: boolean;
  /** Optional command-scoped block whose contents project onto field keys. */
  readonly block?: ProjectConfigBlock;
}

export interface CommandSpec<TConfig = Record<string, unknown>> {
  readonly name: string;
  readonly description: string;
  readonly fields: ReadonlyArray<FieldDescriptor>;
  readonly positionals?: ReadonlyArray<PositionalDescriptor>;
  /**
   * Slice of the whole-project config this command consumes. When a `block`
   * is set, the runner flattens the block's keys onto the field-key namespace
   * (e.g. `serve.port` → field `port`); a registry-wide block like `index` is
   * special-cased to map `index.dir` → field `indexCacheDir`. Defaults to
   * `{ sources: true }`.
   */
  readonly configScope?: ConfigScope;
  readonly handler: (config: TConfig) => Promise<void> | void;
  readonly exitCode: (
    error: unknown,
    context?: { readonly rawConfig?: Record<string, unknown> },
  ) => number;
  readonly refine?: (schema: z.ZodTypeAny) => z.ZodTypeAny;
}
