import { readFile } from 'node:fs/promises';
import { ok, type Result, type ResultAsync } from 'neverthrow';
import { z } from 'zod';
import { formatRdf, parseRdfString } from 'common';
import {
  createGitTreeWalker,
  defaultGlobWalker,
  expandSplitGlobs,
  parseSourceSpecs,
  parseSparqlPrefixes,
  QueryEngine,
  resolveSourceResult,
  selectTargetResult,
  SUPPORTED_FORMATS,
  type EndpointFetchError,
  type ExecuteResult,
  type ParsedSource,
  type QueryExecutionError,
  type QuerySources,
  type SourceError,
  type SourceSpecInput,
  type SparqlFormat,
  type TargetError,
} from 'core';
import { configureLogger } from '../logging';
import { writeOutputToFile } from '../output';
import {
  QueryErrorSignal,
  decorateQueryError,
  queryErrorExitCode,
} from './query-error';
import { applyAtOverride, splitPositionalAddress } from './at-override';
import type { FieldDescriptor } from '../runner/fields/field';
import {
  atRefField,
  contextBaseField,
  contextPrefixesField,
  mutableFieldsFor,
  outFieldFor,
  sourceField,
  verbosityFieldsFor,
} from '../runner/fields/fields-shared';
import type { CommandSpec } from '../runner/fields/spec';

interface QueryConfig {
  sources?: SourceSpecInput[];
  source?: SourceSpecInput;
  query?: string;
  queryFile?: string;
  format?: SparqlFormat;
  mutable?: boolean;
  prefixes?: Record<string, string>;
  base?: string;
  out?: string;
  at?: string;
  verbose?: boolean;
  quiet?: boolean;
  logFormat?: 'text' | 'json';
}

const sourceSpecObjectSchema = z.record(z.string(), z.unknown());

const sourcesRegistryField: FieldDescriptor = {
  key: 'sources',
  schema: z.array(z.union([z.string(), sourceSpecObjectSchema])),
};

const queryField: FieldDescriptor = {
  key: 'query',
  schema: z.string(),
  flags: [
    {
      spec: '-q, --query <sparql>',
      description: 'Inline SPARQL query',
    },
  ],
};

const queryFileField: FieldDescriptor = {
  key: 'queryFile',
  schema: z.string(),
  flags: [
    {
      spec: '--query-file <path>',
      description: 'Path to a file containing the SPARQL query',
    },
  ],
};

const formatField: FieldDescriptor = {
  key: 'format',
  schema: z.enum(SUPPORTED_FORMATS),
  flags: [
    {
      spec: '-f, --format <format>',
      description: 'Override the output format',
    },
  ],
};

export function resolveQueryTargetResult(
  config: QueryConfig,
  registry?: ReadonlyArray<ParsedSource>,
): Result<ParsedSource, TargetError> {
  const effective = registry ?? parseSourceSpecs(config.sources ?? []);
  if (config.source !== undefined && typeof config.source !== 'string') {
    return ok(parseSourceSpecs([config.source])[0]);
  }
  const raw = typeof config.source === 'string' ? config.source : undefined;
  const { targetArg, positionalRef } = splitPositionalAddress(raw);
  return selectTargetResult(effective, targetArg).map((target) =>
    positionalRef === undefined ? target : applyAtOverride(target, positionalRef),
  );
}

export const querySpec: CommandSpec<QueryConfig> = {
  name: 'query',
  description: 'Run a SPARQL query against a target source (an `@id` ref into the config registry, or an inline glob/URL)',
  fields: [
    sourceField,
    sourcesRegistryField,
    queryField,
    queryFileField,
    formatField,
    atRefField,
    ...mutableFieldsFor('query'),
    contextPrefixesField,
    contextBaseField,
    outFieldFor('query'),
    ...verbosityFieldsFor('query'),
  ],
  positionals: [{ field: 'source', name: 'glob' }],
  configScope: { sources: true },
  exitCode: (err) => {
    if (err instanceof QueryErrorSignal) return queryErrorExitCode(err.queryError);
    return 1;
  },
  handler: async (config) => {
    const boundaryLog = configureLogger({
      verbose: config.verbose === true,
      quiet: config.quiet === true,
      logFormat: config.logFormat,
    });

    const stdinQuery = await readStdin();
    const querySources: string[] = [];
    if (config.query) querySources.push('-q/--query');
    if (config.queryFile) querySources.push('--query-file');
    if (stdinQuery) querySources.push('stdin');

    if (querySources.length > 1) {
      throw new Error(
        `only one query source allowed (got ${querySources.join(', ')})`,
      );
    }
    if (querySources.length === 0) {
      throw new Error('a query is required (-q, --query-file, or stdin)');
    }

    let query: string;
    if (config.query) {
      query = config.query;
    } else if (config.queryFile) {
      try {
        query = await readFile(config.queryFile, 'utf8');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`failed to read --query-file: ${message}`);
      }
    } else {
      query = stdinQuery as string;
    }

    const format = config.format;
    const mutable = config.mutable === true;
    const registry = await expandSplitGlobs(
      parseSourceSpecs(config.sources ?? []),
      {
        walkGlob: defaultGlobWalker,
        walkGitGlob: createGitTreeWalker({
          configDir: process.cwd(),
          logger: boundaryLog,
        }),
        logger: boundaryLog,
      },
    );

    const pipeline: ResultAsync<ExecuteResult, SourceError | TargetError> =
      resolveQueryTargetResult(config, registry)
        .map((target) => applyAtOverride(target, config.at))
        .asyncAndThen<ExecuteResult, SourceError | TargetError>((target) => {
        const loadStart = Date.now();
        return resolveSourceResult(target, {
          registry,
          logger: boundaryLog,
          configDir: process.cwd(),
        })
          .map((sources) => {
            logSourceLoaded(boundaryLog, sources, Date.now() - loadStart);
            return sources;
          })
          .andThen((sources) =>
            executeAgainstSources(
              sources,
              target,
              query,
              format,
              mutable,
              boundaryLog,
            ),
          );
      });

    const outcome = await pipeline;

    await outcome.match(
      async (result) => {
        const rendered =
          result.format === 'turtle'
            ? formatTurtleResult(result.body, query, config)
            : result.body;
        const body = rendered.endsWith('\n') ? rendered : `${rendered}\n`;
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
        const color = process.stderr.isTTY === true;
        process.stderr.write(`${decorateQueryError(err, { color })}\n`);
        throw new QueryErrorSignal(err);
      },
    );
  },
};

function executeAgainstSources(
  sources: QuerySources,
  target: ParsedSource,
  query: string,
  format: SparqlFormat | undefined,
  mutable: boolean,
  logger: ReturnType<typeof configureLogger>,
): ResultAsync<ExecuteResult, QueryExecutionError | EndpointFetchError> {
  const engine =
    sources.mode === 'pass-through'
      ? new QueryEngine(sources.endpoint, {
          id: sources.endpoint.endpoint,
          mode: 'pass-through',
          logger,
        })
      : new QueryEngine(sources.store, {
          id:
            target.id ??
            (target.kind === 'glob'
              ? target.glob
              : target.kind === 'file'
                ? target.path
                : '(target)'),
          mode: 'materialized',
          logger,
        });
  return engine.executeResult(query, { format, mutable });
}

function logSourceLoaded(
  logger: ReturnType<typeof configureLogger>,
  sources: QuerySources,
  loadMs: number,
): void {
  if (sources.mode === 'pass-through') {
    logger.debug('source-loaded', {
      mode: sources.mode,
      endpoint: sources.endpoint.endpoint,
      ms: loadMs,
    });
    return;
  }
  logger.debug('source-loaded', {
    mode: sources.mode,
    files: sources.files.length,
    quads: sources.store.size,
    ms: loadMs,
  });
}

function formatTurtleResult(
  body: string,
  query: string,
  config: QueryConfig,
): string {
  const { quads } = parseRdfString(body, { format: 'turtle' });
  const prefixes: Record<string, string> = {
    ...(config.prefixes ?? {}),
    ...parseSparqlPrefixes(query),
  };
  return formatRdf(quads, 'turtle', { prefixes, base: config.base });
}

async function readStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text.length > 0 ? text : null;
}
