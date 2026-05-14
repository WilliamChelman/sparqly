import { z } from 'zod';
import type { FieldDescriptor } from './field';

const coercedBoolean = z.preprocess((v) => {
  if (typeof v === 'string') {
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
  }
  return v;
}, z.boolean());

const sparqlAuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bearer'), token: z.string() }).strict(),
  z
    .object({
      type: z.literal('basic'),
      username: z.string(),
      password: z.string(),
    })
    .strict(),
]);

const cacheBlockSchema = z
  .object({
    ttl: z.union([z.string(), z.number()]).optional(),
    freshness: z.string().optional(),
    everlasting: z.boolean().optional(),
    cacheDir: z.string().optional(),
  })
  .strict();

const sourceObjectSchema = z
  .object({
    id: z.string().optional(),
    glob: z.string().optional(),
    endpoint: z.string().optional(),
    from: z.string().optional(),
    empty: z.literal(true).optional(),
    default: z.literal(true).optional(),
    query: z.string().optional(),
    queryFile: z.string().optional(),
    cache: cacheBlockSchema.optional(),
    transforms: z.array(z.unknown()).optional(),
    auth: sparqlAuthSchema.optional(),
    headers: z.record(z.string(), z.string()).optional(),
    timeoutMs: z.number().int().positive().optional(),
    splitByFile: z.literal(true).optional(),
  })
  .strict();

const sourceSpecInputSchema = z.union([z.string(), sourceObjectSchema]);

export const projectSourcesSchema = z.array(sourceSpecInputSchema);

export const MULTI_SOURCE_REJECTION_MESSAGE =
  'pass a single `--source`/positional value (an `@id` ref or an inline glob/URL); for multi-source composition use a single broader glob, or a `SERVICE` clause inside a view hosted on an `empty` source — see ADR-0005 (docs/adr/0005-single-target-source-at-command-boundary.md)';

export const singleSourceSchema: z.ZodType = z
  .unknown()
  .superRefine((value, ctx) => {
    if (Array.isArray(value)) {
      ctx.addIssue({
        code: 'custom',
        message: MULTI_SOURCE_REJECTION_MESSAGE,
      });
      return;
    }
    const parsed = sourceSpecInputSchema.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: 'custom',
          message: issue.message,
          path: issue.path as PropertyKey[],
        });
      }
    }
  });

export const sourceField: FieldDescriptor = {
  key: 'source',
  schema: singleSourceSchema,
  flags: [
    {
      spec: '-s, --source <spec>',
      description:
        'Single source to run against: an `@id` ref into the config registry, or an inline glob/URL. Alternative to the positional arg.',
    },
  ],
};

/**
 * Legacy multi-source field. Retained for `hash`, `serve`, and `format` until
 * those commands are migrated to the single-target model in #106 / #107. New
 * commands should use `sourceField` and rely on `selectTarget` + `resolveSource`
 * to honor ADR-0005.
 */
export const sourcesField: FieldDescriptor = {
  key: 'sources',
  schema: z.union([sourceSpecInputSchema, z.array(sourceSpecInputSchema).min(1)]),
  flags: [
    {
      spec: '-s, --sources <glob>',
      description:
        'Glob of RDF files to load (alternative to positional arg). Repeat to hash multiple sources independently.',
      parse: (value, prev) => [
        ...((prev as string[] | undefined) ?? []),
        value,
      ],
    },
  ],
};

export function verbosityFieldsFor(
  _commandName: string,
): ReadonlyArray<FieldDescriptor> {
  return [
    {
      key: 'verbose',
      schema: coercedBoolean,
      default: false,
      env: ['SPARQLY_VERBOSE'],
      flags: [
        {
          spec: '-v, --verbose',
          description: 'Verbose logging',
        },
      ],
    },
    {
      key: 'quiet',
      schema: coercedBoolean,
      default: false,
      env: ['SPARQLY_QUIET'],
      flags: [
        {
          spec: '--quiet',
          description: 'Suppress non-result output',
        },
      ],
    },
    {
      key: 'logFormat',
      schema: z.enum(['text', 'json']),
      default: 'text',
      env: ['SPARQLY_LOG_FORMAT'],
      flags: [
        {
          spec: '--log-format <format>',
          description:
            'Log output format on stderr: "text" (human-readable) or "json" (one object per line). Default: text.',
        },
      ],
    },
  ];
}

export function outFieldFor(_commandName: string): FieldDescriptor {
  return {
    key: 'out',
    schema: z.string(),
    flags: [
      {
        spec: '-o, --out <path>',
        description:
          'Write the output to <path> (CWD-relative) instead of stdout. Creates parent directories, silently overwrites, and replaces symlinks at the target.',
      },
    ],
  };
}

export const coercedBooleanSchema = coercedBoolean;

const coercedInt = z.preprocess((v) => {
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return v;
}, z.number().int());

export const coercedIntSchema = coercedInt;

export function mutableFieldsFor(
  _commandName: string,
): ReadonlyArray<FieldDescriptor> {
  return [
    {
      key: 'mutable',
      schema: coercedBoolean,
      default: false,
      flags: [
        {
          spec: '--mutable',
          description:
            'Allow mutating queries (UPDATE/INSERT/DELETE/LOAD). Alias for --immutable=false. Default: mutating queries are rejected.',
          attributeName: 'mutable',
          parse: () => true,
        },
        {
          spec: '--immutable [value]',
          description:
            'Reject mutating queries (default: true). Pass --immutable=false to opt in; equivalent to --mutable.',
          attributeName: 'mutable',
          preset: 'true',
          parse: (value: string) => value === 'false',
        },
      ],
    },
  ];
}

export const contextPrefixesField: FieldDescriptor = {
  key: 'prefixes',
  schema: z.record(z.string(), z.string()),
  merge: 'deep',
};

export const contextBaseField: FieldDescriptor = {
  key: 'base',
  schema: z.string(),
};
