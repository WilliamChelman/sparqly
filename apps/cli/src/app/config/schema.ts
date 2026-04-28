import { z } from 'zod';

const coercedBoolean = z.preprocess((v) => {
  if (typeof v === 'string') {
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
  }
  return v;
}, z.boolean());

const coercedInt = z.preprocess((v) => {
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return v;
}, z.number().int());

const sharedShape = {
  sources: z.string().optional(),
  graphStrategy: z.enum(['default', 'partial', 'full']).optional(),
  mutable: coercedBoolean.optional(),
  verbose: coercedBoolean.optional(),
  quiet: coercedBoolean.optional(),
} as const;

const queryOnlyShape = {
  query: z.string().optional(),
  queryFile: z.string().optional(),
  format: z.enum(['json', 'turtle']).optional(),
} as const;

const serveOnlyShape = {
  port: coercedInt.optional(),
  watch: coercedBoolean.optional(),
  watchDebounce: coercedInt.optional(),
} as const;

export const SHARED_CONFIG_KEYS = Object.keys(sharedShape) as Array<
  keyof typeof sharedShape
>;
export const QUERY_ONLY_KEYS = Object.keys(queryOnlyShape) as Array<
  keyof typeof queryOnlyShape
>;
export const SERVE_ONLY_KEYS = Object.keys(serveOnlyShape) as Array<
  keyof typeof serveOnlyShape
>;

export const QUERY_BLOCK_KEYS = [
  ...SHARED_CONFIG_KEYS,
  ...QUERY_ONLY_KEYS,
] as const;
export const SERVE_BLOCK_KEYS = [
  ...SHARED_CONFIG_KEYS,
  ...SERVE_ONLY_KEYS,
] as const;

export const sharedConfigSchema = z.object(sharedShape).passthrough();

export const queryBlockSchema = z
  .object({ ...sharedShape, ...queryOnlyShape })
  .passthrough();

export const serveBlockSchema = z
  .object({ ...sharedShape, ...serveOnlyShape })
  .passthrough();

export const fileConfigSchema = z
  .object({
    ...sharedShape,
    query: queryBlockSchema.optional(),
    serve: serveBlockSchema.optional(),
  })
  .passthrough();

export type SharedConfig = z.infer<typeof sharedConfigSchema>;
export type QueryBlockConfig = z.infer<typeof queryBlockSchema>;
export type ServeBlockConfig = z.infer<typeof serveBlockSchema>;
export type FileConfig = z.infer<typeof fileConfigSchema>;

export type CommandName = 'query' | 'serve';

export interface EffectiveOptions {
  sources?: string;
  graphStrategy?: 'default' | 'partial' | 'full';
  mutable?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  query?: string;
  queryFile?: string;
  format?: 'json' | 'turtle';
  port?: number;
  watch?: boolean;
  watchDebounce?: number;
}
