import { z } from 'zod';
import { projectSourcesSchema } from './fields/fields-shared';

const serveBlockSchema = z
  .object({
    port: z.number().int(),
    mutable: z.boolean(),
    watch: z.boolean(),
    watchDebounce: z.number().int(),
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

const savedQueriesBlockSchema = z
  .object({
    // Path to the sidecar YAML; relative resolves against the project config dir.
    path: z.string().min(1),
  })
  .partial()
  .strict();

const indexBlockSchema = z
  .object({
    // Glob index cache root; defaults to `<configDir>/.sparqly/index/`.
    // Relative resolves against the project config dir.
    dir: z.string().min(1),
    // Max parallel `sparqly index` child builds `serve` runs. Defaults to 2.
    concurrency: z.number().int().positive(),
  })
  .partial()
  .strict();

const queryBlockSchema = z
  .object({
    // Bounded in-memory query worker pool size (ADR-0050). Mirrors
    // `index.concurrency`; a source is pinned to one worker by hash. Defaults to 2.
    concurrency: z.number().int().positive(),
    // Per-worker LRU resident-store budget in quads (ADR-0050, amends ADR-0031).
    // The worker evicts its least-recently-used idle store when a build pushes it
    // over budget. Defaults high enough that typical small registries never evict.
    maxResidentQuads: z.number().int().positive(),
    // Grace window (ms) before a cancelled query whose worker hasn't torn down
    // its stream is reclaimed by terminate + respawn (ADR-0050). Defaults to 250.
    cancelGraceMs: z.number().int().positive(),
    // Per-worker V8 old-generation ceiling (MB) set as
    // `resourceLimits.maxOldGenerationSizeMb` (ADR-0050). An over-budget query
    // trips a catchable `ERR_WORKER_OUT_OF_MEMORY` that kills only that worker —
    // the hard backstop under the soft `maxResidentQuads` LRU governor. Omitted
    // leaves Node's default (effectively unbounded) heap.
    maxOldGenerationSizeMb: z.number().int().positive(),
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
  'json',
]);

const ROOT_KEY_DESTINATIONS: Record<string, string> = {
  port: 'serve.port',
  watch: 'serve.watch',
  watchDebounce: 'serve.watchDebounce',
  mutable: 'serve.mutable',
  prefixes: 'context.prefixes',
  base: 'context.base',
  objectAnchoredPredicates: 'format.objectAnchoredPredicates',
};

const FORMAT_BLOCK_REDIRECTS: Record<string, string> = {
  prefixes: 'context.prefixes',
  base: 'context.base',
};

const KNOWN_TOP_LEVEL = new Set([
  'sources',
  'serve',
  'format',
  'context',
  'describe',
  'savedQueries',
  'index',
  'query',
]);

// Keys that name a config block AND a per-invocation flag — disambiguated by
// shape: an object is the block, a scalar is the misplaced per-invocation flag.
const BLOCK_OR_PER_INVOCATION = new Set(['format', 'query']);

const baseProjectSchema = z
  .object({
    sources: projectSourcesSchema.optional(),
    serve: serveBlockSchema.optional(),
    format: formatBlockSchema.optional(),
    context: contextBlockSchema.optional(),
    describe: describeBlockSchema.optional(),
    savedQueries: savedQueriesBlockSchema.optional(),
    index: indexBlockSchema.optional(),
    query: queryBlockSchema.optional(),
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
      // `format`/`query` are both block names and per-invocation flags —
      // disambiguate by shape: object → block, scalar → per-invocation.
      if (
        KNOWN_TOP_LEVEL.has(key) &&
        (!BLOCK_OR_PER_INVOCATION.has(key) || isObjectShape)
      ) {
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
