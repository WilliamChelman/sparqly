import 'reflect-metadata';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, join, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { noopLogger, type SparqlyLogger } from 'common';
import { err, ok, type Result } from 'neverthrow';
import {
  createGitTreeWalker,
  defaultGlobWalker,
  expandSplitGlobs,
  type GraphMode,
  type ParsedSource,
  parseSourceSpecs,
  resolveServeScopeResult,
  type SourceSpecInput,
  type TargetError,
  walkGlobPaths,
  warnIfOversizedGlob,
} from 'core';
import { DEFAULT_DESCRIBE_CONFIG, type DescribeConfig } from '../describe';
import { EngineMap } from './engine-map';
import type { SpawnIndexBuild } from './index-build-pool';
import { QueryWorkerPool } from '../sparql/query-worker-pool';
import type { QueryWorkerHandle } from '../sparql/query-worker-protocol';
import { MetaChildrenCache } from './meta-children-cache';
import { maybeStartWatcher } from './multi-source-watcher';
import { RequestLoggingInterceptor } from './request-logging.interceptor';
import { ServerModule } from './server.module';
import { SnippetAllowList } from '../snippet';
import { SourceStateBroker, SourceStateEmitter } from '../sources';
import { sparqlQueryBodyParser } from './sparql-query-body-parser';
import type { SparqlContext } from './tokens';

export interface CreateServerOptions {
  sources: SourceSpecInput | ReadonlyArray<SourceSpecInput>;
  /**
   * Scope filter. `@id` ref narrows the served registry to one entry; an inline
   * glob/URL serves `@default`. Absent → the whole non-`reference` registry is
   * served.
   */
  scope?: string;
  port: number;
  mutable?: boolean;
  graphMode?: GraphMode;
  webRootDir?: string;
  watch?: boolean;
  watchDebounceMs?: number;
  context?: SparqlContext;
  describe?: Partial<DescribeConfig>;
  /** Defaults to no-op. */
  logger?: SparqlyLogger;
  /** Defaults to `<configDir>/.sparqly-queries.yaml`. */
  savedQueriesPath?: string;
  /** Defaults to `process.cwd()`. */
  configDir?: string;
  /** Overrides the Glob index cache root. */
  indexCacheDir?: string;
  /** Refuses sidecar writes (405) and gates admin actions. */
  readOnly?: boolean;
  spawnIndexBuild?: SpawnIndexBuild;
  /**
   * Spawns the in-memory query worker (ADR-0050). When provided, in-memory
   * materialized queries run off the main event loop. Omitting it keeps them on
   * the main thread — the default for library embedders and tests.
   */
  spawnQueryWorker?: () => QueryWorkerHandle;
  /** Defaults to 2. */
  indexConcurrency?: number;
  /** Query worker pool size (`query.concurrency`, ADR-0050). Defaults to 2. */
  queryConcurrency?: number;
  /** Cooperative→nuclear cancel cutover (`query.cancelGraceMs`, ADR-0050).
   * Defaults to 250ms. */
  queryCancelGraceMs?: number;
  /** Query cache global byte budget (`queryCache.maxBytes`, ADR-0054). `null` is
   * explicitly unbounded; omitted uses the 256 MB default. */
  queryCacheMaxBytes?: number | null;
  /** Query cache per-entry ceiling (`queryCache.maxEntryBytes`). 32 MB default. */
  queryCacheMaxEntryBytes?: number;
  /** Defaults to 15_000. */
  sseHeartbeatMs?: number;
  /** Defaults to 256. */
  sseRingCapacity?: number;
}

export interface CreatedServer {
  port: number;
  close: () => Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 250;

export async function createServer(
  options: CreateServerOptions,
): Promise<Result<CreatedServer, TargetError>> {
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
  const scopeResult = resolveServeScopeResult(parsedRegistry, options.scope);
  if (scopeResult.isErr()) return err(scopeResult.error);
  const scope = scopeResult.value;
  if (scope.servedRegistry.length === 0) {
    return err({ kind: 'empty-registry' });
  }

  const startedAt = Date.now();
  // Constructed before EngineMap so transitions emitted during the very
  // first `ensure()` are observed.
  const sourceStateEmitter = new SourceStateEmitter({
    onListenerError: (error) =>
      boundaryLogger.warn('source-state-listener-error', {
        error: error instanceof Error ? error.message : String(error),
      }),
  });
  const queryPool = options.spawnQueryWorker
    ? new QueryWorkerPool({
        spawn: options.spawnQueryWorker,
        concurrency: options.queryConcurrency,
        cancelGraceMs: options.queryCancelGraceMs,
      })
    : undefined;
  const engineMap = await EngineMap.create(scope.servedRegistry, {
    logger: boundaryLogger,
    configDir: options.configDir ?? process.cwd(),
    indexCacheDir: options.indexCacheDir,
    spawnIndexBuild: options.spawnIndexBuild,
    indexConcurrency: options.indexConcurrency,
    queryCacheBudget: {
      maxBytes: options.queryCacheMaxBytes,
      maxEntryBytes: options.queryCacheMaxEntryBytes,
    },
    sourceStateEmitter,
    queryPool,
  });
  const sourceStateBroker = new SourceStateBroker(
    engineMap,
    sourceStateEmitter,
    scope.servedRegistry,
    {
      heartbeatMs: options.sseHeartbeatMs,
      capacity: options.sseRingCapacity,
    },
  );

  const metaChildrenCache = new MetaChildrenCache(scope.servedRegistry, {
    walkGlob: defaultGlobWalker,
    walkGitGlob: createGitTreeWalker({
      configDir: process.cwd(),
      logger: boundaryLogger,
    }),
    logger: boundaryLogger,
  });

  // Snippet allow-list is seeded eagerly via a cheap FS/git walk (no parsing)
  // so `/api/source-snippet` works for files under sources not yet loaded.
  const walkGitGlobForSnippets = createGitTreeWalker({
    configDir: process.cwd(),
    logger: boundaryLogger,
  });
  await seedSnippetPaths(scope.servedRegistry, engineMap, {
    walkGlob: defaultGlobWalker,
    walkGitGlob: walkGitGlobForSnippets,
    logger: boundaryLogger,
  });
  const snippetAllowList = new SnippetAllowList();
  snippetAllowList.update(engineMap.allFiles());

  const app = await NestFactory.create<NestExpressApplication>(
    ServerModule.forRoot({
      engineMap,
      servedRegistry: scope.servedRegistry,
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
      sourcesAdmin: {
        allowAdminActions: options.readOnly !== true,
      },
      // ADR-0054: caching reads/writes are untouched by --read-only; only the
      // destructive clear is.
      cacheAdmin: {
        allowClear: options.readOnly !== true,
      },
      sourceStateBroker,
      logger: boundaryLogger,
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
        engineMap,
        graphMode: options.graphMode,
        logger,
        boundaryLogger,
        debounceMs: options.watchDebounceMs ?? DEFAULT_DEBOUNCE_MS,
        snippetAllowList,
        // Same cheap walkers used to seed the allow-list at boot — the watcher
        // re-walks with them to keep it in sync on FS changes (#391).
        walkGlob: defaultGlobWalker,
        walkGitGlob: walkGitGlobForSnippets,
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

  return ok({
    port: listeningPort,
    close: async () => {
      if (watcher) await watcher.close();
      // Completes SSE observables so in-flight `/api/sources/stream`
      // responses end (otherwise `app.close()` waits on them forever).
      sourceStateBroker.close();
      const closing = app.close();
      // Node's `http.Server.close()` waits for all sockets to close,
      // including idle keep-alive ones held by the browser after the
      // SSE response ends — force them shut so shutdown can complete.
      const httpServer = app.getHttpServer() as {
        closeIdleConnections?: () => void;
      };
      httpServer.closeIdleConnections?.();
      await closing;
      await engineMap.close();
    },
  });
}

async function seedSnippetPaths(
  servedRegistry: ReadonlyArray<ParsedSource>,
  engineMap: EngineMap,
  deps: {
    walkGlob: Parameters<typeof walkGlobPaths>[1]['walkGlob'];
    walkGitGlob: Parameters<typeof walkGlobPaths>[1]['walkGitGlob'];
    logger: SparqlyLogger;
  },
): Promise<void> {
  for (const src of servedRegistry) {
    if (src.id === undefined) continue;
    if (src.kind === 'glob') {
      const paths = await walkGlobPaths(src, deps);
      engineMap.setFiles(src.id, paths);
      // Discoverability nudge for un-flagged globs that should use `storage: disk`.
      await warnIfOversizedGlob(src, paths, { logger: deps.logger });
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
    // Unresolved paths with a file extension are missing assets — let them
    // 404 rather than masking them with the SPA shell.
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
