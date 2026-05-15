import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { ResultAsync, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import type { SparqlyLogger } from 'common';
import {
  canonicalizeStore,
  defaultGlobWalker,
  expandSplitGlobs,
  extractAnnotationPredicates,
  parseSourceSpecs,
  resolveAnonymousViewResult,
  resolveSourceResult,
  selectTargetResult,
  type ParsedSource,
  type SourceError,
  type SourceSpecInput,
  type TargetError,
} from 'core';
import { configureLogger } from '../logging';
import { writeOutputToFile } from '../output';
import {
  HashErrorSignal,
  decorateHashError,
  hashErrorExitCode,
} from './hash-error';
import { applyAtOverride } from './at-override';
import type { FieldDescriptor } from '../runner/fields/field';
import {
  atRefField,
  coercedBooleanSchema,
  outFieldFor,
  sourceField,
  verbosityFieldsFor,
} from '../runner/fields/fields-shared';
import type { CommandSpec } from '../runner/fields/spec';

interface HashConfig {
  sources?: SourceSpecInput[];
  source?: SourceSpecInput;
  json?: boolean;
  compareWith?: string;
  query?: string;
  queryFile?: string;
  compareWithQuery?: string;
  compareWithQueryFile?: string;
  out?: string;
  at?: string;
  verbose?: boolean;
  quiet?: boolean;
  logFormat?: 'text' | 'json';
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
  flags: [
    {
      spec: '--compare-with <source>',
      description:
        "Hash a second target source (an `@id` ref into the registry, or an inline glob/URL) with the same loader options and compare against the primary target. Exit 0 on match (stdout 'match: <hash>'), 1 on mismatch (stdout shows both labeled hashes), 30-53 on error per the per-variant source/target map in hash-error.ts. SPARQL endpoint targets are rejected on this side (use a `view` source kind to scope an endpoint, or pass --compare-with-query/--compare-with-query-file).",
    },
  ],
};

const queryField: FieldDescriptor = {
  key: 'query',
  schema: z.string().min(1),
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
  flags: [
    {
      spec: '--json',
      description:
        'Emit a JSON object { source, hash } instead of the default `<hash>  <source-spec>` line. Not applicable in --compare-with mode.',
    },
  ],
};

export function resolveHashTargetResult(
  config: HashConfig,
  registry?: ReadonlyArray<ParsedSource>,
): Result<ParsedSource, TargetError> {
  const effective = registry ?? parseSourceSpecs(config.sources ?? []);
  const targetArg =
    typeof config.source === 'string' ? config.source : undefined;
  if (config.source !== undefined && targetArg === undefined) {
    return ok(parseSourceSpecs([config.source])[0]);
  }
  return selectTargetResult(effective, targetArg);
}

function resolveCompareTargetResult(
  compareWith: string,
  registry: ReadonlyArray<ParsedSource>,
): Result<ParsedSource, TargetError> {
  return selectTargetResult(registry, compareWith);
}

export const hashSpec: CommandSpec<HashConfig> = {
  name: 'hash',
  description:
    'Compute a stable SHA-256 over the canonicalized RDF content of a target source (an `@id` ref into the config registry, or an inline glob/URL). Materializes the *result*; for endpoint-backed views the query passes through to the endpoint. A SPARQL endpoint target is rejected as a raw input (wrap it in a `view` source kind to scope it, or pass `--query`/`--query-file` to scope it inline). Determinism caveat: a remote endpoint can return different data between runs, so a SPARQL hash is only as deterministic as the endpoint.',
  fields: [
    sourceField,
    sourcesRegistryField,
    jsonField,
    compareWithField,
    queryField,
    queryFileField,
    compareWithQueryField,
    compareWithQueryFileField,
    atRefField,
    outFieldFor('hash'),
    ...verbosityFieldsFor('hash'),
  ],
  positionals: [{ field: 'source', name: 'glob' }],
  configScope: { sources: true },
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
    if (err instanceof HashErrorSignal) return hashErrorExitCode(err.hashError);
    const isCompareMode = ctx?.rawConfig?.compareWith !== undefined;
    return isCompareMode ? 2 : 1;
  },
  handler: async (config) => {
    const logger = configureLogger({
      verbose: config.verbose === true,
      quiet: config.quiet === true,
      logFormat: config.logFormat,
    });

    const isCompareMode = config.compareWith !== undefined;

    if (isCompareMode && config.out !== undefined) {
      throw new HashCompareError(
        '--out cannot be combined with --compare-with (compare-mode output is verdict-tied to the exit code)',
      );
    }

    const inlineQuery = await loadInlineScopeQuery(config);
    const compareInlineQuery = await loadCompareInlineScopeQuery(config);

    const registry = await expandSplitGlobs(
      parseSourceSpecs(config.sources ?? []),
      { walkGlob: defaultGlobWalker, logger },
    );

    if (isCompareMode) {
      const compareSpec = config.compareWith as string;
      const pair = await resolveHashTargetResult(config, registry)
        .map((primaryTarget) => applyAtOverride(primaryTarget, config.at))
        .asyncAndThen<HashedPair, SourceError | TargetError>((primaryTarget) =>
          resolveCompareTargetResult(compareSpec, registry).asyncAndThen(
            (secondaryTarget) =>
              ResultAsync.combine([
                hashTargetResult(
                  primaryTarget,
                  registry,
                  inlineQuery,
                  logger,
                ),
                hashTargetResult(
                  secondaryTarget,
                  registry,
                  compareInlineQuery,
                  logger,
                ),
              ]).map(([primary, secondary]) => ({ primary, secondary })),
          ),
        );

      await pair.match(
        ({ primary, secondary }) => {
          if (primary.hash === secondary.hash) {
            process.stdout.write(`match: ${primary.hash}\n`);
            return;
          }
          process.stdout.write(`${primary.hash}  ${primary.source}\n`);
          process.stdout.write(`${secondary.hash}  ${secondary.source}\n`);
          throw new HashMismatchSignal('hash mismatch');
        },
        (err) => {
          emitHashError(err);
          throw new HashErrorSignal(err);
        },
      );
      return;
    }

    const single = await resolveHashTargetResult(config, registry)
      .map((target) => applyAtOverride(target, config.at))
      .asyncAndThen<{ source: string; hash: string }, SourceError | TargetError>(
        (target) => hashTargetResult(target, registry, inlineQuery, logger),
      );

    await single.match(
      async (result) => {
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
      async (err) => {
        emitHashError(err);
        throw new HashErrorSignal(err);
      },
    );
  },
};

interface HashedPair {
  primary: { source: string; hash: string };
  secondary: { source: string; hash: string };
}

function emitHashError(err: SourceError | TargetError): void {
  const color = process.stderr.isTTY === true;
  process.stderr.write(`${decorateHashError(err, { color })}\n`);
}

function targetLabel(target: ParsedSource): string {
  if (target.id !== undefined) return `@${target.id}`;
  if (target.kind === 'glob') return target.glob;
  if (target.kind === 'file') return target.path;
  if (target.kind === 'endpoint') return target.endpoint;
  if (target.kind === 'empty') return `@${target.id ?? 'empty'}`;
  if (target.kind === 'view') return `@${target.id}`;
  return '<unknown>';
}

function hashTargetResult(
  target: ParsedSource,
  registry: ReadonlyArray<ParsedSource>,
  inlineQuery: string | undefined,
  logger: SparqlyLogger,
): ResultAsync<{ source: string; hash: string }, SourceError> {
  const label = targetLabel(target);
  const start = Date.now();

  if (inlineQuery !== undefined) {
    const upstreamSpec = anonymousUpstream(target);
    return resolveAnonymousViewResult({
      source: upstreamSpec,
      query: inlineQuery,
      logger,
    })
      .map((store) => {
        logger.debug('source-loaded', {
          mode: 'view',
          source: label,
          quads: store.size,
          ms: Date.now() - start,
        });
        return store;
      })
      .andThen((store) =>
        ResultAsync.fromSafePromise(canonicalizeStore(store)).map(
          ({ canonicalText }) => ({
            source: label,
            hash: createHash('sha256').update(canonicalText).digest('hex'),
          }),
        ),
      );
  }

  if (target.kind === 'endpoint') {
    throw new Error(
      `SPARQL endpoint ${target.endpoint} cannot be hashed directly (hash materializes the result, but a raw endpoint has no scoping query; wrap the endpoint in a \`view\` source kind to scope it, pass \`--query\`/\`--query-file\` to scope it inline, or pipe \`sparqly query --format=turtle\` into \`sparqly hash\`)`,
    );
  }

  return resolveSourceResult(target, {
    registry,
    logger,
    configDir: process.cwd(),
  }).andThen<{ source: string; hash: string }, SourceError>((sources) => {
    if (sources.mode === 'pass-through') {
      throw new Error(
        `SPARQL endpoint ${sources.endpoint.endpoint} cannot be hashed directly (hash materializes the result, but a raw endpoint has no scoping query; wrap the endpoint in a \`view\` source kind to scope it, pass \`--query\`/\`--query-file\` to scope it inline, or pipe \`sparqly query --format=turtle\` into \`sparqly hash\`)`,
      );
    }
    return ResultAsync.fromSafePromise(
      canonicalizeStore(sources.store, {
        annotationPredicates: extractAnnotationPredicates(
          target.kind === 'glob' || target.kind === 'file'
            ? target.transforms
            : undefined,
        ),
      }),
    ).map(({ canonicalText }) => {
      const hash = createHash('sha256').update(canonicalText).digest('hex');
      logger.debug('source-loaded', {
        mode: 'materialized',
        source: label,
        files: sources.files.length,
        quads: sources.store.size,
        ms: Date.now() - start,
      });
      return { source: label, hash };
    });
  });
}

function anonymousUpstream(target: ParsedSource): SourceSpecInput {
  if (target.kind === 'glob') return target.glob;
  if (target.kind === 'file') return target.path;
  if (target.kind === 'endpoint') return target.endpoint;
  throw new Error(
    `--query/--query-file scope a glob, file, or SPARQL endpoint upstream; target ${targetLabel(target)} is a ${target.kind} source — drop the inline scope (it already has a query) or point at a glob/file/endpoint`,
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
