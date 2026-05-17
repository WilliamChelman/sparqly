import 'reflect-metadata';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, join, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { noopLogger, type SparqlyLogger } from 'common';
import {
  createGitTreeWalker,
  defaultGlobWalker,
  expandSplitGlobs,
  type GraphMode,
  type ParsedSource,
  parseSourceSpecs,
  resolveServeScope,
  type SourceSpecInput,
  walkGlobPaths,
} from 'core';
import { DEFAULT_DESCRIBE_CONFIG, type DescribeConfig } from '../describe';
import { EngineMap } from './engine-map';
import { MetaChildrenCache } from './meta-children-cache';
import { maybeStartWatcher } from './multi-source-watcher';
import { RequestLoggingInterceptor } from './request-logging.interceptor';
import { ServerModule } from './server.module';
import { SnippetAllowList } from '../snippet';
import { sparqlQueryBodyParser } from './sparql-query-body-parser';
import type { SparqlContext } from './tokens';

export interface CreateServerOptions {
  sources: SourceSpecInput | ReadonlyArray<SourceSpecInput>;
  /**
   * Scope filter for what `serve` exposes. An `@id` ref into `sources` narrows
   * the served/listed set to that one entry (its `from:` deps stay resolvable
   * but unlisted); an inline glob/URL serves a single synthesized `@default`
   * with the configured `sources:` available for `from:` resolution only.
   * Absent → the whole non-`reference` registry is served.
   */
  scope?: string;
  port: number;
  mutable?: boolean;
  graphMode?: GraphMode;
  webRootDir?: string;
  watch?: boolean;
  watchDebounceMs?: number;
  watchPollMs?: number;
  /**
   * Display context (`prefixes`/`base`) surfaced to clients via /api/config so
   * they can shorten IRIs the same way the CLI does. Optional — defaults to
   * empty `prefixes` and no `base`.
   */
  context?: SparqlContext;
  /**
   * Registry-wide describe defaults (from the project config's `describe:`
   * block). Any missing field falls back to {@link DEFAULT_DESCRIBE_CONFIG}.
   * Surfaced to clients via /api/config.
   */
  describe?: Partial<DescribeConfig>;
  /**
   * Boundary logger (ADR-0020). Emits the per-request `info` line and the
   * `--verbose` SPARQL-execution `debug` lines for the served sources.
   * Defaults to the no-op logger so non-CLI callers stay silent.
   */
  logger?: SparqlyLogger;
  /**
   * Absolute or config-relative path to the saved-query sidecar (ADR-0036).
   * Defaults to `<cwd>/.sparqly-queries.yaml`. Surfaced on `/api/config` so the
   * webapp can name the file in tooltips.
   */
  savedQueriesPath?: string;
  /**
   * Override the `configDir` used to resolve a relative `savedQueriesPath` to
   * an absolute path. Defaults to `process.cwd()`.
   */
  configDir?: string;
  /**
   * When `true`, `serve` refuses writes to the saved-query sidecar: PUT/DELETE
   * return 405 and `/api/config` advertises `savedQueries.writable: false`.
   * Defaults to `false` (writes allowed).
   */
  readOnly?: boolean;
}

export interface CreatedServer {
  port: number;
  close: () => Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_POLL_MS = 1000;

export async function createServer(
  options: CreateServerOptions,
): Promise<CreatedServer> {
  const logger = new Logger('sparqly');
  const boundaryLogger = options.logger ?? noopLogger;
  const parsedRegistry = await expandSplitGlobs(
    parseSourceSpecs(toSourceArray(options.sources)),
    {
      walkGlob: defaultGlobWalker,
      walkGitGlob: createGitTreeWalker({
        configDir: process.cwd(),
        logger: boundaryLogger,
      }),
      logger: boundaryLogger,
    },
  );
  const scope = resolveServeScope(parsedRegistry, options.scope);
  if (scope.servedRegistry.length === 0) {
    throw new Error(
      'No sources configured. Pass a positional/--source, or define `sources:` in your config.',
    );
  }

  const startedAt = Date.now();
  const engineMap = await EngineMap.create(scope.servedRegistry, {
    resolutionRegistry: scope.resolutionRegistry,
    logger: boundaryLogger,
  });

  const metaChildrenCache = new MetaChildrenCache(scope.servedRegistry, {
    walkGlob: defaultGlobWalker,
    walkGitGlob: createGitTreeWalker({
      configDir: process.cwd(),
      logger: boundaryLogger,
    }),
    logger: boundaryLogger,
  });

  // Lazy materialization (ADR-0031): the snippet allow-list and per-source
  // file paths are seeded eagerly via `walkGlobPaths` (cheap FS / git-tree
  // walk, no parsing) so `/api/source-snippet` requests succeed for files
  // under sources whose Stores have not yet been built.
  const walkGitGlobForSnippets = createGitTreeWalker({
    configDir: process.cwd(),
    logger: boundaryLogger,
  });
  await seedSnippetPaths(scope.servedRegistry, engineMap, {
    walkGlob: defaultGlobWalker,
    walkGitGlob: walkGitGlobForSnippets,
  });
  const snippetAllowList = new SnippetAllowList();
  snippetAllowList.update(engineMap.allFiles());

  const app = await NestFactory.create<NestExpressApplication>(
    ServerModule.forRoot({
      engineMap,
      servedRegistry: scope.servedRegistry,
      resolutionRegistry: scope.resolutionRegistry,
      metaChildrenCache,
      defaultId: scope.defaultId,
      config: { mutable: options.mutable === true },
      context: options.context ?? { prefixes: {} },
      describe: resolveDescribeConfig(options.describe),
      snippetAllowList,
      savedQueries: {
        path: resolveSavedQueriesPath(options),
        writable: options.readOnly !== true,
      },
    }),
    { abortOnError: false },
  );
  app.setGlobalPrefix('api');
  app.use(sparqlQueryBodyParser);
  app.useGlobalInterceptors(new RequestLoggingInterceptor(boundaryLogger));

  if (options.webRootDir) {
    mountWebPlayground(app, options.webRootDir);
  }

  await app.listen(options.port);
  const url = await app.getUrl();
  const listeningPort = portFromUrl(url) ?? options.port;
  boundaryLogger.info('serve-ready', {
    sources: engineMap.allIds().length,
    port: listeningPort,
    ms: Date.now() - startedAt,
  });
  const ids = engineMap.allIds();
  if (ids.length === 1) {
    logger.log(`SPARQL endpoint for @${ids[0]} at ${url}/api/sparql/${ids[0]}`);
  } else if (ids.length > 1) {
    logger.log(
      `Serving ${ids.length} SPARQL endpoints at ${url}/api/sparql/<id> (see ${url}/api/config for the full list)`,
    );
  }
  if (scope.defaultId !== undefined) {
    logger.log(`Default SPARQL endpoint at ${url}/api/sparql`);
  }
  logger.log(`Config + source listing at ${url}/api/config`);
  if (options.webRootDir) {
    logger.log(`Web playground served at ${url}/`);
  }

  const watcher = options.watch
    ? await maybeStartWatcher({
        servedRegistry: scope.servedRegistry,
        resolutionRegistry: scope.resolutionRegistry,
        engineMap,
        graphMode: options.graphMode,
        logger,
        boundaryLogger,
        debounceMs: options.watchDebounceMs ?? DEFAULT_DEBOUNCE_MS,
        pollMs: options.watchPollMs ?? DEFAULT_POLL_MS,
        snippetAllowList,
        metaChildrenCache,
      })
    : undefined;
  if (watcher) {
    logger.log(
      `Watching for changes (debounce: ${
        options.watchDebounceMs ?? DEFAULT_DEBOUNCE_MS
      }ms)`,
    );
  }

  return {
    port: listeningPort,
    close: async () => {
      if (watcher) await watcher.close();
      await app.close();
      await engineMap.close();
    },
  };
}

async function seedSnippetPaths(
  servedRegistry: ReadonlyArray<ParsedSource>,
  engineMap: EngineMap,
  deps: {
    walkGlob: Parameters<typeof walkGlobPaths>[1]['walkGlob'];
    walkGitGlob: Parameters<typeof walkGlobPaths>[1]['walkGitGlob'];
  },
): Promise<void> {
  for (const src of servedRegistry) {
    if (src.id === undefined) continue;
    if (src.kind === 'glob') {
      const paths = await walkGlobPaths(src, deps);
      engineMap.setFiles(src.id, paths);
    } else if (src.kind === 'file') {
      engineMap.setFiles(src.id, [src.path]);
    }
  }
}

const DEFAULT_SAVED_QUERIES_FILENAME = '.sparqly-queries.yaml';

function resolveSavedQueriesPath(options: CreateServerOptions): string {
  const configDir = options.configDir ?? process.cwd();
  const raw = options.savedQueriesPath;
  if (raw === undefined) {
    return resolve(configDir, DEFAULT_SAVED_QUERIES_FILENAME);
  }
  return isAbsolute(raw) ? raw : resolve(configDir, raw);
}

function resolveDescribeConfig(
  partial: Partial<DescribeConfig> | undefined,
): DescribeConfig {
  return {
    perSourceSoftLimit:
      partial?.perSourceSoftLimit ?? DEFAULT_DESCRIBE_CONFIG.perSourceSoftLimit,
    perSourceHardLimit:
      partial?.perSourceHardLimit ?? DEFAULT_DESCRIBE_CONFIG.perSourceHardLimit,
    fromSourcePredicate:
      partial?.fromSourcePredicate ??
      DEFAULT_DESCRIBE_CONFIG.fromSourcePredicate,
  };
}

function toSourceArray(
  sources: SourceSpecInput | ReadonlyArray<SourceSpecInput>,
): ReadonlyArray<SourceSpecInput> {
  if (Array.isArray(sources)) return sources;
  return [sources as SourceSpecInput];
}

type Next = (err?: unknown) => void;

function mountWebPlayground(
  app: NestExpressApplication,
  webRootDir: string,
): void {
  app.useStaticAssets(webRootDir, { index: ['index.html'] });
  const indexPath = join(webRootDir, 'index.html');
  app.use((req: IncomingMessage, res: ServerResponse, next: Next) => {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      next();
      return;
    }
    const url = req.url ?? '/';
    const path = url.split('?', 1)[0];
    if (path.startsWith('/api/') || path === '/api') {
      next();
      return;
    }
    // Static-assets middleware already handled real files. Anything still
    // unresolved with a file extension is a missing asset — let it 404
    // rather than silently masking it with the SPA shell.
    const lastSegment = path.slice(path.lastIndexOf('/') + 1);
    if (lastSegment.includes('.')) {
      next();
      return;
    }
    const accept = (req.headers['accept'] ?? '').toString();
    if (accept && !accept.includes('text/html') && !accept.includes('*/*')) {
      next();
      return;
    }
    void (async () => {
      try {
        const info = await stat(indexPath);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Length', String(info.size));
        res.setHeader('Cache-Control', 'no-cache');
        if (method === 'HEAD') {
          res.end();
          return;
        }
        const stream = createReadStream(indexPath);
        stream.on('error', next);
        stream.pipe(res);
      } catch (err) {
        next(err);
      }
    })();
  });
}

function portFromUrl(url: string): number | undefined {
  try {
    const parsed = new URL(url);
    const port = Number.parseInt(parsed.port, 10);
    return Number.isFinite(port) ? port : undefined;
  } catch {
    return undefined;
  }
}
