import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  canonicalizeStore,
  extractAnnotationPredicates,
  parseSourceSpecs,
  resolveAnonymousView,
  resolveSource,
  selectTarget,
  type GraphMode,
  type ParsedSource,
  type SourceSpecInput,
} from 'core';
import { configureLogger } from '../logging';
import { writeOutputToFile } from '../output';
import type { FieldDescriptor } from '../runner/field';
import {
  coercedBooleanSchema,
  graphModeFieldFor,
  outFieldFor,
  sourceField,
  verbosityFieldsFor,
} from '../runner/fields-shared';
import type { CommandSpec } from '../runner/spec';

interface HashConfig {
  sources?: SourceSpecInput[];
  source?: SourceSpecInput;
  graphMode?: GraphMode;
  json?: boolean;
  compareWith?: string;
  query?: string;
  queryFile?: string;
  compareWithQuery?: string;
  compareWithQueryFile?: string;
  out?: string;
  verbose?: boolean;
  quiet?: boolean;
}

class HashMismatchSignal extends Error {
  readonly silent = true;
  constructor(message: string) {
    super(message);
    this.name = 'HashMismatchSignal';
  }
}

class HashCompareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HashCompareError';
  }
}

const sourceSpecObjectSchema = z.record(z.string(), z.unknown());

const sourcesRegistryField: FieldDescriptor = {
  key: 'sources',
  schema: z.array(z.union([z.string(), sourceSpecObjectSchema])),
};

const compareWithField: FieldDescriptor = {
  key: 'compareWith',
  schema: z.string(),
  env: ['SPARQLY_HASH_COMPARE_WITH'],
  flags: [
    {
      spec: '--compare-with <source>',
      description:
        "Hash a second target source (an `@id` ref into the registry, or an inline glob/URL) with the same loader options and compare against the primary target. Exit 0 on match (stdout 'match: <hash>'), 1 on mismatch (stdout shows both labeled hashes), 2 on error. SPARQL endpoint targets are rejected on this side (use a `view` source kind to scope an endpoint, or pass --compare-with-query/--compare-with-query-file).",
    },
  ],
};

const queryField: FieldDescriptor = {
  key: 'query',
  schema: z.string().min(1),
  env: ['SPARQLY_HASH_QUERY'],
  flags: [
    {
      spec: '--query <sparql>',
      description:
        'Inline SPARQL CONSTRUCT or SELECT-{?s,?p,?o[,?g]} that scopes the target source. Required for SPARQL endpoint targets; otherwise optional. Lowers to an anonymous, uncached view. Mutually exclusive with --query-file.',
    },
  ],
};

const queryFileField: FieldDescriptor = {
  key: 'queryFile',
  schema: z.string().min(1),
  env: ['SPARQLY_HASH_QUERY_FILE'],
  flags: [
    {
      spec: '--query-file <path>',
      description:
        'Path to a SPARQL file (relative to CWD) used as the inline scoping query. Mutually exclusive with --query.',
    },
  ],
};

const compareWithQueryField: FieldDescriptor = {
  key: 'compareWithQuery',
  schema: z.string().min(1),
  env: ['SPARQLY_HASH_COMPARE_WITH_QUERY'],
  flags: [
    {
      spec: '--compare-with-query <sparql>',
      description:
        'Inline SPARQL CONSTRUCT or SELECT-{?s,?p,?o[,?g]} that scopes the --compare-with side. Required for SPARQL endpoint targets on that side; otherwise optional. Lowers to an anonymous, uncached view. Mutually exclusive with --compare-with-query-file. Requires --compare-with.',
    },
  ],
};

const compareWithQueryFileField: FieldDescriptor = {
  key: 'compareWithQueryFile',
  schema: z.string().min(1),
  env: ['SPARQLY_HASH_COMPARE_WITH_QUERY_FILE'],
  flags: [
    {
      spec: '--compare-with-query-file <path>',
      description:
        'Path to a SPARQL file (relative to CWD) used as the inline scoping query for the --compare-with side. Mutually exclusive with --compare-with-query. Requires --compare-with.',
    },
  ],
};

const jsonField: FieldDescriptor = {
  key: 'json',
  schema: coercedBooleanSchema,
  default: false,
  env: ['SPARQLY_HASH_JSON'],
  flags: [
    {
      spec: '--json',
      description:
        'Emit a JSON object { source, hash } instead of the default `<hash>  <source-spec>` line. Not applicable in --compare-with mode.',
    },
  ],
};

export function resolveHashTarget(config: HashConfig): ParsedSource {
  const registry = parseSourceSpecs(config.sources ?? []);
  const targetArg =
    typeof config.source === 'string' ? config.source : undefined;
  if (config.source !== undefined && targetArg === undefined) {
    return parseSourceSpecs([config.source])[0];
  }
  return selectTarget(registry, targetArg);
}

function resolveCompareTarget(
  config: HashConfig,
  compareWith: string,
): ParsedSource {
  const registry = parseSourceSpecs(config.sources ?? []);
  return selectTarget(registry, compareWith);
}

export const hashSpec: CommandSpec<HashConfig> = {
  name: 'hash',
  description:
    'Compute a stable SHA-256 over the canonicalized RDF content of a target source (an `@id` ref into the config registry, or an inline glob/URL). Materializes the *result*; for endpoint-backed views the query passes through to the endpoint. A SPARQL endpoint target is rejected as a raw input (wrap it in a `view` source kind to scope it, or pass `--query`/`--query-file` to scope it inline). Determinism caveat: a remote endpoint can return different data between runs, so a SPARQL hash is only as deterministic as the endpoint.',
  fields: [
    sourceField,
    sourcesRegistryField,
    graphModeFieldFor('hash'),
    jsonField,
    compareWithField,
    queryField,
    queryFileField,
    compareWithQueryField,
    compareWithQueryFileField,
    outFieldFor('hash'),
    ...verbosityFieldsFor('hash'),
  ],
  positionals: [{ field: 'source', name: 'glob' }],
  refine: (schema) =>
    (schema as z.ZodObject).superRefine(
      (val: Record<string, unknown>, ctx) => {
        const hasQuery = typeof val.query === 'string';
        const hasQueryFile = typeof val.queryFile === 'string';
        if (hasQuery && hasQueryFile) {
          ctx.addIssue({
            code: 'custom',
            message:
              '`--query` and `--query-file` are mutually exclusive on `hash`',
            path: ['query'],
          });
        }

        const hasCompareQuery = typeof val.compareWithQuery === 'string';
        const hasCompareQueryFile = typeof val.compareWithQueryFile === 'string';
        if (hasCompareQuery && hasCompareQueryFile) {
          ctx.addIssue({
            code: 'custom',
            message:
              '`--compare-with-query` and `--compare-with-query-file` are mutually exclusive on `hash`',
            path: ['compareWithQuery'],
          });
        }
        const hasCompareInlineScope = hasCompareQuery || hasCompareQueryFile;

        const compareWith = val.compareWith;
        if (hasCompareInlineScope && typeof compareWith !== 'string') {
          ctx.addIssue({
            code: 'custom',
            message:
              '`--compare-with-query`/`--compare-with-query-file` requires `--compare-with`',
            path: ['compareWithQuery'],
          });
        }
      },
    ),
  exitCode: (err, ctx) => {
    if (err instanceof HashMismatchSignal) return 1;
    const isCompareMode = ctx?.rawConfig?.compareWith !== undefined;
    return isCompareMode ? 2 : 1;
  },
  handler: async (config) => {
    configureLogger({
      verbose: config.verbose === true,
      quiet: config.quiet === true,
    });

    const isCompareMode = config.compareWith !== undefined;

    if (isCompareMode && config.out !== undefined) {
      throw new HashCompareError(
        '--out cannot be combined with --compare-with (compare-mode output is verdict-tied to the exit code)',
      );
    }

    const logger = new Logger('sparqly');
    const graphMode = config.graphMode as GraphMode | undefined;
    const inlineQuery = await loadInlineScopeQuery(config);
    const compareInlineQuery = await loadCompareInlineScopeQuery(config);

    if (isCompareMode) {
      const compareSpec = config.compareWith as string;
      let primary: { source: string; hash: string };
      let secondary: { source: string; hash: string };
      try {
        const primaryTarget = resolveHashTarget(config);
        const secondaryTarget = resolveCompareTarget(config, compareSpec);
        primary = await hashTarget(
          primaryTarget,
          config,
          graphMode,
          inlineQuery,
          logger,
        );
        secondary = await hashTarget(
          secondaryTarget,
          config,
          graphMode,
          compareInlineQuery,
          logger,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new HashCompareError(message);
      }

      if (primary.hash === secondary.hash) {
        process.stdout.write(`match: ${primary.hash}\n`);
        return;
      }
      process.stdout.write(`${primary.hash}  ${primary.source}\n`);
      process.stdout.write(`${secondary.hash}  ${secondary.source}\n`);
      throw new HashMismatchSignal('hash mismatch');
    }

    const target = resolveHashTarget(config);
    const result = await hashTarget(target, config, graphMode, inlineQuery, logger);

    const body = config.json
      ? `${JSON.stringify(result)}\n`
      : `${result.hash}  ${result.source}\n`;

    if (config.out !== undefined) {
      await writeOutputToFile({
        out: config.out,
        cwd: process.cwd(),
        body,
      });
    } else {
      process.stdout.write(body);
    }
  },
};

function targetLabel(target: ParsedSource): string {
  if (target.id !== undefined) return `@${target.id}`;
  if (target.kind === 'glob') return target.glob;
  if (target.kind === 'endpoint') return target.endpoint;
  if (target.kind === 'empty') return `@${target.id ?? 'empty'}`;
  if (target.kind === 'view') return `@${target.id}`;
  return '<unknown>';
}

async function hashTarget(
  target: ParsedSource,
  config: HashConfig,
  graphMode: GraphMode | undefined,
  inlineQuery: string | undefined,
  logger: Logger,
): Promise<{ source: string; hash: string }> {
  const label = targetLabel(target);
  const start = Date.now();

  if (inlineQuery !== undefined) {
    const upstreamSpec = anonymousUpstream(target);
    const store = await resolveAnonymousView({
      source: upstreamSpec,
      query: inlineQuery,
    });
    const { canonicalText } = await canonicalizeStore(store);
    const hash = createHash('sha256').update(canonicalText).digest('hex');
    logger.log(
      `Materialized anonymous view (${store.size} quads), canonicalized + hashed '${label}' in ${Date.now() - start}ms`,
    );
    return { source: label, hash };
  }

  if (target.kind === 'endpoint') {
    throw new Error(
      `SPARQL endpoint ${target.endpoint} cannot be hashed directly (hash materializes the result, but a raw endpoint has no scoping query; wrap the endpoint in a \`view\` source kind to scope it, pass \`--query\`/\`--query-file\` to scope it inline, or pipe \`sparqly query --format=turtle\` into \`sparqly hash\`)`,
    );
  }

  const registry = parseSourceSpecs(config.sources ?? []);
  const sources = await resolveSource(target, { graphMode, registry });
  if (sources.mode === 'pass-through') {
    throw new Error(
      `SPARQL endpoint ${sources.endpoint.endpoint} cannot be hashed directly (hash materializes the result, but a raw endpoint has no scoping query; wrap the endpoint in a \`view\` source kind to scope it, pass \`--query\`/\`--query-file\` to scope it inline, or pipe \`sparqly query --format=turtle\` into \`sparqly hash\`)`,
    );
  }
  const { canonicalText } = await canonicalizeStore(sources.store, {
    annotationPredicates: extractAnnotationPredicates(
      target.kind === 'glob' ? target.transforms : undefined,
    ),
  });
  const hash = createHash('sha256').update(canonicalText).digest('hex');
  logger.log(
    `Loaded ${sources.files.length} file(s) (${sources.store.size} quads), canonicalized + hashed '${label}' in ${Date.now() - start}ms`,
  );
  return { source: label, hash };
}

function anonymousUpstream(target: ParsedSource): SourceSpecInput {
  if (target.kind === 'glob') return target.glob;
  if (target.kind === 'endpoint') return target.endpoint;
  throw new Error(
    `--query/--query-file scope a glob or SPARQL endpoint upstream; target ${targetLabel(target)} is a ${target.kind} source — drop the inline scope (it already has a query) or point at a glob/endpoint`,
  );
}

async function loadInlineScopeQuery(
  config: HashConfig,
): Promise<string | undefined> {
  if (typeof config.query === 'string') return config.query;
  if (typeof config.queryFile === 'string') {
    const path = resolvePath(process.cwd(), config.queryFile);
    return readFile(path, 'utf8');
  }
  return undefined;
}

async function loadCompareInlineScopeQuery(
  config: HashConfig,
): Promise<string | undefined> {
  if (typeof config.compareWithQuery === 'string') return config.compareWithQuery;
  if (typeof config.compareWithQueryFile === 'string') {
    const path = resolvePath(process.cwd(), config.compareWithQueryFile);
    return readFile(path, 'utf8');
  }
  return undefined;
}

export { HashMismatchSignal, HashCompareError };
