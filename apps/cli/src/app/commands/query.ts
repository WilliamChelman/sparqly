import { extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { ok, ResultAsync, type Result } from 'neverthrow';
import { z } from 'zod';
import { formatRdf, parseRdfString } from 'common';
import {
  CachingQueryExecutor,
  createGitTreeWalker,
  defaultGlobWalker,
  cacheSourceId,
  DEFAULT_QUERY_CACHE_TTL_MS,
  digestContext,
  freshnessTokenFor,
  queryCacheCap,
  sourceQueryCacheOptIn,
  expandSplitGlobs,
  MIME_TO_FORMAT,
  N3_FORMAT_BY_EXT,
  openQueryCache,
  parseSourceSpecs,
  parseSparqlPrefixes,
  QueryEngine,
  queryCacheDir,
  resolveSourceResult,
  selectTargetResult,
  SUPPORTED_FORMATS,
  unionDefaultGraphEnabled,
  type EndpointFetchError,
  type ExecuteResult,
  type ParsedSource,
  type QueryExecutionError,
  type QueryExecutor,
  type QuerySources,
  type SourceError,
  type SourceSpecInput,
  type SparqlFormat,
  type TargetError,
} from 'core';
import { cliVersion } from '../cli-version';
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
  indexCacheDir?: string;
  /** Global Query cache byte budget from `queryCache.maxBytes` (`null` = unbounded). */
  queryCacheMaxBytes?: number | null;
  /** Per-entry ceiling from `queryCache.maxEntryBytes`. */
  queryCacheMaxEntryBytes?: number;
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

// Read from the top-level `index.dir` config block, not a CLI flag — the
// index location is a project-shaped deployment knob.
const indexCacheDirField: FieldDescriptor = {
  key: 'indexCacheDir',
  schema: z.string().min(1),
};

// Read from the top-level `queryCache` block (already resolved to bytes by the
// project-config schema); a project-shaped budget, not a per-invocation flag.
const queryCacheMaxBytesField: FieldDescriptor = {
  key: 'queryCacheMaxBytes',
  schema: z.union([z.number().int().positive(), z.null()]),
};

const queryCacheMaxEntryBytesField: FieldDescriptor = {
  key: 'queryCacheMaxEntryBytes',
  schema: z.number().int().positive(),
};

export function inferQueryFormatFromOut(
  out: string | undefined,
): SparqlFormat | undefined {
  if (out === undefined) return undefined;
  const mime = N3_FORMAT_BY_EXT[extname(out).toLowerCase()];
  return mime ? MIME_TO_FORMAT[mime] : undefined;
}

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
    positionalRef === undefined
      ? target
      : applyAtOverride(target, positionalRef),
  );
}

export const querySpec: CommandSpec<QueryConfig> = {
  name: 'query',
  description:
    'Run a SPARQL query against a target source (an `@id` ref into the config registry, or an inline glob/URL)',
  fields: [
    sourceField,
    sourcesRegistryField,
    queryField,
    queryFileField,
    formatField,
    indexCacheDirField,
    queryCacheMaxBytesField,
    queryCacheMaxEntryBytesField,
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
    if (err instanceof QueryErrorSignal)
      return queryErrorExitCode(err.queryError);
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

    const format = config.format ?? inferQueryFormatFromOut(config.out);
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

    // Disk-backed globs hand back an open LevelDB handle; capture the closer
    // so the embedded lock is released whether the query succeeds or fails.
    let closeIndex: (() => Promise<void>) | undefined;
    // An opted-in endpoint opens the on-disk Query cache for this invocation;
    // capture its closer so the SQLite handle is released on either outcome.
    let closeCache: (() => void) | undefined;

    const pipeline: ResultAsync<ExecuteResult, SourceError | TargetError> =
      resolveQueryTargetResult(config, registry)
        .map((target) => applyAtOverride(target, config.at))
        .asyncAndThen<ExecuteResult, SourceError | TargetError>((target) => {
          const loadStart = Date.now();
          return resolveSourceResult(target, {
            logger: boundaryLog,
            configDir: process.cwd(),
            sparqlyVersion: cliVersion(),
            indexCacheDir: config.indexCacheDir,
          })
            .map((sources) => {
              if (sources.mode === 'disk-backed') closeIndex = sources.close;
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
                config,
                (close) => {
                  closeCache = close;
                },
              ),
            );
        });

    const outcome = await pipeline;
    if (closeIndex !== undefined) await closeIndex();
    if (closeCache !== undefined) closeCache();

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
  config: QueryConfig,
  registerClose: (close: () => void) => void,
): ResultAsync<ExecuteResult, QueryExecutionError | EndpointFetchError> {
  const engine = buildQueryEngine(sources, target, logger);
  return ResultAsync.fromSafePromise(
    maybeWithQueryCache(engine, sources, target, config, logger, registerClose),
  ).andThen((executor) => executor.executeResult(query, { format, mutable }));
}

/**
 * Wraps the bare engine in the read-through Query cache when the source opted in
 * (`queryCache`, ADR-0054). Covers every resolution path: an endpoint keys on TTL
 * alone, while a materialized glob/file, a pinned source, or a disk-backed glob
 * folds a path-aware freshness token (#415) into the key so an underlying change
 * recomputes. The cache is opened for this CLI invocation; its closer is
 * registered so the SQLite handle is released after the query settles. A source
 * that did not opt in — or any failure computing the token or opening the store —
 * returns the bare engine, so the query still runs uncached.
 */
async function maybeWithQueryCache(
  engine: QueryEngine,
  sources: QuerySources,
  target: ParsedSource,
  config: QueryConfig,
  logger: ReturnType<typeof configureLogger>,
  registerClose: (close: () => void) => void,
): Promise<QueryExecutor> {
  const queryCache = sourceQueryCacheOptIn(target);
  if (queryCache === undefined) return engine;
  try {
    const freshnessToken = await freshnessTokenFor(sources);
    const cache = openQueryCache({
      dir: queryCacheDir(process.cwd()),
      schemaVersion: cliVersion(),
      ttlMs: DEFAULT_QUERY_CACHE_TTL_MS,
      maxBytes: config.queryCacheMaxBytes,
      maxEntryBytes: config.queryCacheMaxEntryBytes,
      logger,
    });
    registerClose(() => cache.close());
    return new CachingQueryExecutor({
      delegate: engine,
      cache,
      sourceId: cacheSourceId(target),
      sourceMaxBytes: queryCacheCap(queryCache),
      contextDigest: digestContext({
        prefixes: config.prefixes,
        base: config.base,
      }),
      freshnessToken,
      schemaVersion: cliVersion(),
      mode: 'normal',
      logger,
    });
  } catch (err) {
    logger.debug('query-cache-disabled', {
      source: cacheSourceId(target),
      reason: err instanceof Error ? err.message : String(err),
    });
    return engine;
  }
}

function buildQueryEngine(
  sources: QuerySources,
  target: ParsedSource,
  logger: ReturnType<typeof configureLogger>,
): QueryEngine {
  if (sources.mode === 'pass-through') {
    return new QueryEngine(sources.endpoint, {
      id: sources.endpoint.endpoint,
      mode: 'pass-through',
      logger,
    });
  }
  const id =
    target.id ??
    (target.kind === 'glob'
      ? target.glob
      : target.kind === 'file'
        ? target.path
        : '(target)');
  const store = sources.mode === 'disk-backed' ? sources.source : sources.store;
  return new QueryEngine(
    store,
    { id, mode: 'materialized', logger },
    { unionDefaultGraph: unionDefaultGraphEnabled(target) },
  );
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
  if (sources.mode === 'disk-backed') {
    // The quads live on disk, not the heap — no cheap `.size` to report.
    logger.debug('source-loaded', {
      mode: sources.mode,
      files: sources.files.length,
      indexDir: sources.indexDir,
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
