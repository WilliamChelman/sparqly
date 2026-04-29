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

interface FieldDef {
  readonly schema: z.ZodTypeAny;
  readonly default?: unknown;
}

const SHARED_FIELDS: Record<string, FieldDef> = {
  sources: { schema: z.string() },
  graphStrategy: {
    schema: z.enum(['default', 'partial', 'full']),
    default: 'default',
  },
  mutable: { schema: coercedBoolean, default: false },
  verbose: { schema: coercedBoolean, default: false },
  quiet: { schema: coercedBoolean, default: false },
};

const QUERY_ONLY_FIELDS: Record<string, FieldDef> = {
  query: { schema: z.string() },
  queryFile: { schema: z.string() },
  format: { schema: z.enum(['json', 'turtle']) },
};

const SERVE_ONLY_FIELDS: Record<string, FieldDef> = {
  port: { schema: coercedInt, default: 3000 },
  watch: { schema: coercedBoolean, default: false },
  watchDebounce: { schema: coercedInt, default: 250 },
};

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

function shapeOf(
  fields: Record<string, FieldDef>,
): Record<string, z.ZodTypeAny> {
  const out: Record<string, z.ZodTypeAny> = {};
  for (const [key, def] of Object.entries(fields)) {
    out[key] = def.schema.optional();
  }
  return out;
}

function defaultsOf(
  ...groups: Array<Record<string, FieldDef>>
): Partial<EffectiveOptions> {
  const out: Record<string, unknown> = {};
  for (const group of groups) {
    for (const [key, def] of Object.entries(group)) {
      if ('default' in def) out[key] = def.default;
    }
  }
  return out as Partial<EffectiveOptions>;
}

export const SHARED_KEYS: ReadonlyArray<string> = Object.keys(SHARED_FIELDS);
export const QUERY_BLOCK_KEYS: ReadonlyArray<string> = [
  ...SHARED_KEYS,
  ...Object.keys(QUERY_ONLY_FIELDS),
];
export const SERVE_BLOCK_KEYS: ReadonlyArray<string> = [
  ...SHARED_KEYS,
  ...Object.keys(SERVE_ONLY_FIELDS),
];

const sharedShape = shapeOf(SHARED_FIELDS);

export const sharedConfigSchema = z.object(sharedShape).passthrough();
export const queryBlockSchema = z
  .object({ ...sharedShape, ...shapeOf(QUERY_ONLY_FIELDS) })
  .passthrough();
export const serveBlockSchema = z
  .object({ ...sharedShape, ...shapeOf(SERVE_ONLY_FIELDS) })
  .passthrough();
export const fileConfigSchema = z
  .object({
    ...sharedShape,
    query: queryBlockSchema.optional(),
    serve: serveBlockSchema.optional(),
  })
  .passthrough();

export function defaultsFor(command: CommandName): Partial<EffectiveOptions> {
  return command === 'query'
    ? defaultsOf(SHARED_FIELDS, QUERY_ONLY_FIELDS)
    : defaultsOf(SHARED_FIELDS, SERVE_ONLY_FIELDS);
}

export function blockKeysFor(command: CommandName): ReadonlyArray<string> {
  return command === 'query' ? QUERY_BLOCK_KEYS : SERVE_BLOCK_KEYS;
}

export function blockSchemaFor(command: CommandName): z.ZodTypeAny {
  return command === 'query' ? queryBlockSchema : serveBlockSchema;
}
