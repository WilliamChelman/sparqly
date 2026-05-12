import { z } from 'zod';
import { projectSourcesSchema } from './fields/fields-shared';

const serveBlockSchema = z
  .object({
    port: z.number().int(),
    mutable: z.boolean(),
    watch: z.boolean(),
    watchDebounce: z.number().int(),
    watchPoll: z.number().int(),
  })
  .partial()
  .strict();

const formatBlockSchema = z
  .object({
    objectAnchoredPredicates: z.array(z.string()),
  })
  .partial()
  .strict();

const contextBlockSchema = z
  .object({
    prefixes: z.record(z.string(), z.string()),
    base: z.string(),
  })
  .partial()
  .strict();

const cacheBlockSchema = z
  .object({
    dir: z.string(),
  })
  .partial()
  .strict();

const describeBlockSchema = z
  .object({
    // Per-source quad cap applied when a request omits `perSourceLimit`.
    perSourceSoftLimit: z.number().int().positive(),
    // Absolute ceiling; a request-supplied `perSourceLimit` is clamped to it.
    perSourceHardLimit: z.number().int().positive(),
    // Default RDF-star annotation predicate for describe provenance.
    fromSourcePredicate: z.string().min(1),
  })
  .partial()
  .strict();

const PER_INVOCATION_KEYS = new Set([
  'out',
  'query',
  'format',
  'write',
  'check',
  'compareWith',
  'left',
  'right',
  'snippetContext',
  'skipAutoSourceAnnotation',
  'json',
]);

const ROOT_KEY_DESTINATIONS: Record<string, string> = {
  port: 'serve.port',
  watch: 'serve.watch',
  watchDebounce: 'serve.watchDebounce',
  watchPoll: 'serve.watchPoll',
  mutable: 'serve.mutable',
  prefixes: 'context.prefixes',
  base: 'context.base',
  objectAnchoredPredicates: 'format.objectAnchoredPredicates',
  cacheDir: 'cache.dir',
};

const FORMAT_BLOCK_REDIRECTS: Record<string, string> = {
  prefixes: 'context.prefixes',
  base: 'context.base',
};

const KNOWN_TOP_LEVEL = new Set([
  'sources',
  'serve',
  'format',
  'cache',
  'context',
  'describe',
]);

const baseProjectSchema = z
  .object({
    sources: projectSourcesSchema.optional(),
    serve: serveBlockSchema.optional(),
    format: formatBlockSchema.optional(),
    cache: cacheBlockSchema.optional(),
    context: contextBlockSchema.optional(),
    describe: describeBlockSchema.optional(),
  })
  .strict();

export const projectConfigSchema = baseProjectSchema;

// The strict z.object already rejects unknown keys with a generic message.
// We add a separate pre-validation pass to surface friendlier messages for
// known per-invocation keys and known block-misplaced keys at root.
export function validateProjectConfig(parsed: unknown):
  | { ok: true; data: ProjectConfig }
  | { ok: false; issues: ReadonlyArray<{ path: string; message: string }> } {
  const issues: { path: string; message: string }[] = [];
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      const isObjectShape =
        typeof value === 'object' && value !== null && !Array.isArray(value);
      // `format` is both a block name and a per-invocation flag — disambiguate
      // by shape: object → block, scalar → per-invocation.
      if (KNOWN_TOP_LEVEL.has(key) && (key !== 'format' || isObjectShape)) {
        continue;
      }
      if (PER_INVOCATION_KEYS.has(key)) {
        issues.push({
          path: key,
          message: `${key} at root not allowed; --${kebab(key)} is per-invocation, pass it on the command line instead`,
        });
        continue;
      }
      const dest = ROOT_KEY_DESTINATIONS[key];
      if (dest !== undefined) {
        issues.push({
          path: key,
          message: `${key} at root not allowed; move to ${dest}`,
        });
      }
    }
    const formatBlock = obj.format;
    if (
      formatBlock !== null &&
      typeof formatBlock === 'object' &&
      !Array.isArray(formatBlock)
    ) {
      for (const [k, dest] of Object.entries(FORMAT_BLOCK_REDIRECTS)) {
        if (k in (formatBlock as Record<string, unknown>)) {
          issues.push({
            path: `format.${k}`,
            message: `${k} under format: not allowed; move to ${dest}`,
          });
        }
      }
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  const result = baseProjectSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((iss) => ({
        path: iss.path.length > 0 ? iss.path.join('.') : '<root>',
        message: iss.message,
      })),
    };
  }
  return { ok: true, data: result.data };
}

function kebab(key: string): string {
  return key.replace(/([A-Z])/g, '-$1').toLowerCase();
}

export type ProjectConfig = z.infer<typeof baseProjectSchema>;
