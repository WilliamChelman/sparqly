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
  warnIfOversizedGlob,
} from 'core';
import { DEFAULT_DESCRIBE_CONFIG, type DescribeConfig } from '../describe';
import { EngineMap } from './engine-map';
import type { SpawnIndexBuild } from './index-build-pool';
import { MetaChildrenCache } from './meta-children-cache';
import { maybeStartWatcher } from './multi-source-watcher';
import { RequestLoggingInterceptor } from './request-logging.interceptor';
import { ServerModule } from './server.module';
import { SnippetAllowList } from '../snippet';
import {
  SourceStateBroker,
  SourceStateEmitter,
} from '../sources';
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
   * an absolute path, and as the root for `<configDir>/.sparqly/index/<id>/`
   * disk-backed Glob index directories (ADR-0041). Defaults to `process.cwd()`.
   */
  configDir?: string;
  /**
   * Overrides the Glob index cache root (ADR-0041, #345). When set, disk-backed
   * globs build and reuse their index under `<indexCacheDir>/<id>/` instead of
   * the default `<configDir>/.sparqly/index/<id>/`. Threaded from the project
   * config's `index.dir` field.
   */
  indexCacheDir?: string;
  /**
   * When `true`, `serve` refuses writes to the saved-query sidecar: PUT/DELETE
   * return 405 and `/api/config` advertises `savedQueries.writable: false`.
   * Defaults to `false` (writes allowed).
   */
  readOnly?: boolean;
  /**
   * Spawns the isolated `sparqly index @id` child that builds a disk-backed
   * glob's Glob index (ADR-0042). The CLI `serve` command injects a real
   * implementation; omitting it leaves disk-backed builds unavailable, so
   * touching a not-yet-built disk-backed source then throws.
   */
  spawnIndexBuild?: SpawnIndexBuild;
  /**
   * Maximum number of child-process index builds running at once
   * (`index.concurrency`, ADR-0042). Disk-backed sources first-touched past
   * the cap queue for a free slot. Defaults to 2.
   */
  indexConcurrency?: number;
  /**
   * Heartbeat cadence for the Sources page SSE stream (ADR-0044, #354)
   * in milliseconds. Defaults to 15_000 — the proxy-friendly idle window.
   * Tests pass a small value (e.g. 30) so heartbeat assertions are fast.
   */
  sseHeartbeatMs?: number;
  /**
   * Capacity of the {@link SourceStateBroker}'s ring buffer of recent
   * transitions (ADR-0044, #354). Defaults to 256 — the conventional
   * reconnect window. Tests pass a tiny value (e.g. 1) to drive the
   * `refetch-snapshot` sentinel branch on unbridgeable reconnects.
   */
  sseRingCapacity?: number;
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
  // Source state emitter feeds the Sources page SSE stream (ADR-0044,
  // #354). Constructed before EngineMap so transitions emitted during the
  // very first `ensure()` (e.g. an auto-warmed endpoint) are observed.
  const sourceStateEmitter = new SourceStateEmitter({
    onListenerError: (error) =>
      boundaryLogger.warn('source-state-listener-error', {
        error: error instanceof Error ? error.message : String(error),
      }),
  });
  const engineMap = await EngineMap.create(scope.servedRegistry, {
    resolutionRegistry: scope.resolutionRegistry,
    logger: boundaryLogger,
    // Root for `<configDir>/.sparqly/index/<id>/` disk-backed Glob index
    // directories (ADR-0041); `indexCacheDir` redirects that root (#345).
    configDir: options.configDir ?? process.cwd(),
    indexCacheDir: options.indexCacheDir,
    spawnIndexBuild: options.spawnIndexBuild,
    indexConcurrency: options.indexConcurrency,
    sourceStateEmitter,
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
    logger: boundaryLogger,
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
      sourcesAdmin: {
        // ADR-0045: defaulted from the same `serve --read-only` switch as
        // `savedQueries.writable`. Project config can override this flag
        // independently in a later slice — for now CLI is the only source.
        allowAdminActions: options.readOnly !== true,
      },
      sourceStateBroker,
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
      sourceStateBroker.close();
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
    logger: SparqlyLogger;
  },
): Promise<void> {
  for (const src of servedRegistry) {
    if (src.id === undefined) continue;
    if (src.kind === 'glob') {
      const paths = await walkGlobPaths(src, deps);
      engineMap.setFiles(src.id, paths);
      // Discoverability hint (ADR-0041): an un-flagged glob whose matched
      // bytes are heap-risky earns a `storage: disk` nudge. Rides the eager
      // path walk above — file sizes only, no parsing.
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
