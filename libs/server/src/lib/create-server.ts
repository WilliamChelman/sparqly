import 'reflect-metadata';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, sep } from 'node:path';
import * as chokidar from 'chokidar';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { Store } from 'n3';
import {
  type GraphMode,
  parseSourceSpecs,
  type ParsedSource,
  type ParsedViewSource,
  QueryEngine,
  resolveSource,
  selectTarget,
  type SourceSpecInput,
} from 'core';
import { EngineMap } from './engine-map';
import { ServerModule } from './server.module';
import { SnippetAllowList } from './snippet-allow-list';
import type {
  SourceListingEntry,
  SparqlContext,
  StoreRef,
} from './tokens';
import {
  buildWatcherChain,
  type WatcherChain,
  type WatcherSourcePlan,
} from './watcher-chain';

export interface CreateServerOptions {
  sources: SourceSpecInput | ReadonlyArray<SourceSpecInput>;
  /**
   * Selector for the target source within `sources`. An `@id` ref into the
   * registry, or an inline glob/URL. Same precedence as the CLI: explicit
   * value > `default: true` > sole entry > error.
   */
  target?: string;
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
  const inputs = toSourceArray(options.sources);
  const registry = parseSourceSpecs(inputs);

  const isRegistryMode =
    options.target === undefined &&
    !(inputs.length === 1 && registry.length === 1 && registry[0].id === undefined);

  if (isRegistryMode) {
    return startRegistryMode(options, registry, logger);
  }

  const target = selectTarget(registry, options.target);

  const loadStart = Date.now();
  const querySources = await resolveSource(target, {
    graphMode: options.graphMode,
    registry,
  });

  let engine: QueryEngine;
  let storeRef: StoreRef | undefined;
  let initialFiles: ReadonlyArray<string> = [];
  if (querySources.mode === 'pass-through') {
    logger.log(
      `Federating to endpoint ${querySources.endpoint.endpoint} in ${
        Date.now() - loadStart
      }ms`,
    );
    engine = new QueryEngine(querySources.endpoint);
  } else {
    logger.log(
      `Loaded ${querySources.files.length} file(s) (${querySources.store.size} quads) in ${
        Date.now() - loadStart
      }ms`,
    );
    storeRef = { current: querySources.store };
    const ref = storeRef;
    engine = new QueryEngine(() => ref.current);
    initialFiles = querySources.files;
  }

  const snippetAllowList = new SnippetAllowList();
  snippetAllowList.update(initialFiles);
  const singleSourceFiles = new Map<ParsedSource, ReadonlyArray<string>>();
  singleSourceFiles.set(target, initialFiles);

  const app = await NestFactory.create<NestExpressApplication>(
    ServerModule.forRoot({
      mode: 'single',
      engine,
      listing: buildSingleListing(target),
      config: { mutable: options.mutable === true },
      context: options.context ?? { prefixes: {} },
      snippetAllowList,
    }),
    { abortOnError: false },
  );
  app.setGlobalPrefix('api');
  app.use(sparqlQueryBodyParser);

  if (options.webRootDir) {
    mountWebPlayground(app, options.webRootDir);
  }

  await app.listen(options.port);
  const url = await app.getUrl();
  logger.log(`SPARQL endpoint listening at ${url}/api/sparql`);
  if (options.webRootDir) {
    logger.log(`Web playground served at ${url}/`);
  }

  const watcher = options.watch
    ? await maybeStartSingleSourceWatcher({
        target,
        registry,
        graphMode: options.graphMode,
        storeRef,
        logger,
        debounceMs: options.watchDebounceMs ?? DEFAULT_DEBOUNCE_MS,
        pollMs: options.watchPollMs ?? DEFAULT_POLL_MS,
        snippetAllowList,
        singleSourceFiles,
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
    port: portFromUrl(url) ?? options.port,
    close: async () => {
      if (watcher) await watcher.close();
      await app.close();
    },
  };
}

async function startRegistryMode(
  options: CreateServerOptions,
  registry: ReadonlyArray<ParsedSource>,
  logger: Logger,
): Promise<CreatedServer> {
  const totalStart = Date.now();
  const engineMap = await EngineMap.create(registry, {
    onSourceLoaded: (id, kind, ms) => {
      logger.log(`Loaded @${id} (${kind}) in ${ms}ms`);
    },
  });
  logger.log(
    `Registry mode: ${engineMap.allIds().length} source(s) ready in ${
      Date.now() - totalStart
    }ms`,
  );

  const listing = buildListing(registry);

  const snippetAllowList = new SnippetAllowList();
  snippetAllowList.update(engineMap.allFiles());

  const app = await NestFactory.create<NestExpressApplication>(
    ServerModule.forRoot({
      mode: 'registry',
      engineMap,
      registry,
      listing,
      config: { mutable: options.mutable === true },
      context: options.context ?? { prefixes: {} },
      snippetAllowList,
    }),
    { abortOnError: false },
  );
  app.setGlobalPrefix('api');
  app.use(sparqlQueryBodyParser);

  if (options.webRootDir) {
    mountWebPlayground(app, options.webRootDir);
  }

  await app.listen(options.port);
  const url = await app.getUrl();
  for (const id of engineMap.allIds()) {
    logger.log(`SPARQL endpoint for @${id} at ${url}/api/sparql/${id}`);
  }
  logger.log(`Config + source listing at ${url}/api/config`);
  if (options.webRootDir) {
    logger.log(`Web playground served at ${url}/`);
  }

  const watcher = options.watch
    ? await maybeStartRegistryWatcher({
        registry,
        engineMap,
        graphMode: options.graphMode,
        logger,
        debounceMs: options.watchDebounceMs ?? DEFAULT_DEBOUNCE_MS,
        pollMs: options.watchPollMs ?? DEFAULT_POLL_MS,
        snippetAllowList,
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
    port: portFromUrl(url) ?? options.port,
    close: async () => {
      if (watcher) await watcher.close();
      await app.close();
      await engineMap.close();
    },
  };
}

function buildSingleListing(target: ParsedSource): SourceListingEntry[] {
  if (target.kind === 'reference') return [];
  const id = target.id ?? 'source';
  const entry: SourceListingEntry = {
    id,
    kind: target.kind,
    label: id,
    default: true,
  };
  return [entry];
}

function buildListing(
  registry: ReadonlyArray<ParsedSource>,
): SourceListingEntry[] {
  const out: SourceListingEntry[] = [];
  for (const src of registry) {
    if (src.kind === 'reference') continue;
    if (src.id === undefined) continue;
    const entry: SourceListingEntry = {
      id: src.id,
      kind: src.kind,
      label: src.id,
    };
    if ((src as { default?: true }).default === true) entry.default = true;
    out.push(entry);
  }
  return out;
}

function toSourceArray(
  sources: SourceSpecInput | ReadonlyArray<SourceSpecInput>,
): ReadonlyArray<SourceSpecInput> {
  if (Array.isArray(sources)) return sources;
  return [sources as SourceSpecInput];
}

interface WatcherHandle {
  close: () => Promise<void>;
}

type RefreshTrigger =
  | { kind: 'file-change'; path: string }
  | { kind: 'ttl'; viewId: string }
  | { kind: 'freshness'; viewId: string };

function triggerLabel(trigger: RefreshTrigger): string {
  switch (trigger.kind) {
    case 'file-change':
      return 'file change';
    case 'ttl':
      return 'ttl';
    case 'freshness':
      return 'freshness';
  }
}

interface SingleSourceWatcherOptions {
  target: ParsedSource;
  registry: ReadonlyArray<ParsedSource>;
  graphMode?: GraphMode;
  storeRef: StoreRef | undefined;
  logger: Logger;
  debounceMs: number;
  pollMs: number;
  snippetAllowList: SnippetAllowList;
  singleSourceFiles: Map<ParsedSource, ReadonlyArray<string>>;
}

async function maybeStartSingleSourceWatcher(
  opts: SingleSourceWatcherOptions,
): Promise<WatcherHandle | undefined> {
  // Single-source mode reuses the multi-source builder over the full registry
  // — including any `@id` upstreams the target's `from:` chain needs — but
  // narrows the resulting WatcherChain down to just the target's plan. The
  // target may not be in `opts.registry` when it was supplied as an inline
  // positional/--source (`selectTarget` synthesises a fresh source in that
  // case), so we ensure it leads the effective registry.
  const effectiveRegistry: ReadonlyArray<ParsedSource> = opts.registry.includes(
    opts.target,
  )
    ? opts.registry
    : [opts.target, ...opts.registry];
  const fullChain = buildWatcherChain(effectiveRegistry);
  const plan = fullChain.sources.find((p) => p.source === opts.target);

  if (!plan) {
    opts.logger.warn(
      '--watch ignored: no glob source in the target chain and no `cache.ttl`/`cache.freshness` views to refresh. SPARQL endpoints are not auto-refreshed; restart the process to pick up upstream changes.',
    );
    return undefined;
  }
  if (!opts.storeRef) {
    opts.logger.warn(
      '--watch ignored: target resolves pass-through to an endpoint; nothing local to refresh.',
    );
    return undefined;
  }

  const narrowedChain: WatcherChain = {
    sources: [plan],
    passThrough: [],
    globBases: plan.globBases,
  };
  const storeRef = opts.storeRef;
  const filesMap = opts.singleSourceFiles;
  return startMultiSourceWatcher(
    [
      {
        plan,
        storeRef,
        target: opts.target,
        registry: opts.registry,
        onRebuiltFiles: (files) => {
          filesMap.set(opts.target, files);
          opts.snippetAllowList.update(unionFiles(filesMap.values()));
        },
      },
    ],
    narrowedChain,
    {
      graphMode: opts.graphMode,
      logger: opts.logger,
      debounceMs: opts.debounceMs,
      pollMs: opts.pollMs,
    },
  );
}

interface RegistryWatcherOptions {
  registry: ReadonlyArray<ParsedSource>;
  engineMap: EngineMap;
  graphMode?: GraphMode;
  logger: Logger;
  debounceMs: number;
  pollMs: number;
  snippetAllowList: SnippetAllowList;
}

async function maybeStartRegistryWatcher(
  opts: RegistryWatcherOptions,
): Promise<WatcherHandle | undefined> {
  const chain = buildWatcherChain(opts.registry);

  for (const skipped of chain.passThrough) {
    const id = (skipped as { id?: string }).id;
    if (id === undefined) continue;
    if (skipped.kind === 'endpoint') {
      opts.logger.warn(
        `--watch: skipping @${id}; endpoint sources are not auto-refreshed.`,
      );
    } else {
      opts.logger.warn(
        `--watch: skipping @${id}; chain has no glob source and no \`cache.ttl\`/\`cache.freshness\` views to refresh.`,
      );
    }
  }

  const targets: WatchedSource[] = [];
  for (const plan of chain.sources) {
    if (plan.id === undefined) continue;
    const storeRef = opts.engineMap.getStoreRef(plan.id);
    if (!storeRef) {
      opts.logger.warn(
        `--watch: skipping @${plan.id}; resolves pass-through to an endpoint.`,
      );
      continue;
    }
    const sourceId = plan.id;
    targets.push({
      plan,
      storeRef,
      target: plan.source,
      registry: opts.registry,
      onRebuiltFiles: (files) => {
        opts.engineMap.setFiles(sourceId, files);
        opts.snippetAllowList.update(opts.engineMap.allFiles());
      },
    });
  }

  if (targets.length === 0) return undefined;

  return startMultiSourceWatcher(targets, chain, {
    graphMode: opts.graphMode,
    logger: opts.logger,
    debounceMs: opts.debounceMs,
    pollMs: opts.pollMs,
  });
}

interface WatchedSource {
  plan: WatcherSourcePlan;
  storeRef: StoreRef;
  target: ParsedSource;
  registry: ReadonlyArray<ParsedSource>;
  /**
   * Notification fired after every successful materialized rebuild with the
   * absolute paths the loader actually opened on this rebuild. Used to keep
   * the snippet allow-list in sync with the resolution result so that newly
   * matched files become readable and removed files stop being readable.
   */
  onRebuiltFiles?: (files: ReadonlyArray<string>) => void;
}

interface MultiSourceWatcherDeps {
  graphMode?: GraphMode;
  logger: Logger;
  debounceMs: number;
  pollMs: number;
}

async function startMultiSourceWatcher(
  targets: ReadonlyArray<WatchedSource>,
  chain: WatcherChain,
  deps: MultiSourceWatcherDeps,
): Promise<WatcherHandle> {
  let watcher: chokidar.FSWatcher | undefined;
  if (chain.globBases.length > 0) {
    watcher = chokidar.watch([...chain.globBases], {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
    });
    await new Promise<void>((resolveReady, rejectReady) => {
      const w = watcher as chokidar.FSWatcher;
      const onReady = (): void => {
        w.off('error', onError);
        resolveReady();
      };
      const onError = (err: unknown): void => {
        w.off('ready', onReady);
        rejectReady(err instanceof Error ? err : new Error(String(err)));
      };
      w.once('ready', onReady);
      w.once('error', onError);
    });
  }

  const sourceRunners = new Map<WatchedSource, SourceRunner>();
  for (const t of targets) {
    sourceRunners.set(t, createSourceRunner(t, deps));
  }

  const onFileEvent = (path: string): void => {
    for (const [t, runner] of sourceRunners) {
      if (!pathBelongsToPlan(path, t.plan)) continue;
      runner.schedule({ kind: 'file-change', path });
    }
  };

  if (watcher) {
    watcher.on('add', onFileEvent);
    watcher.on('change', onFileEvent);
    watcher.on('unlink', onFileEvent);
  }

  // Per-source TTL + freshness handles.
  const ttlHandles: ScheduledHandle[] = [];
  const freshnessHandles: ScheduledHandle[] = [];
  for (const t of targets) {
    const runner = sourceRunners.get(t);
    if (!runner) continue;
    ttlHandles.push(startTtlTimers(t.plan.cachedViews, runner.schedule));
    freshnessHandles.push(
      startFreshnessPolls(
        t.plan.cachedViews,
        t.plan.chain,
        deps.pollMs,
        deps.logger,
        runner.schedule,
      ),
    );
  }

  return {
    close: async () => {
      for (const runner of sourceRunners.values()) runner.dispose();
      for (const h of ttlHandles) h.stop();
      for (const h of freshnessHandles) h.stop();
      if (watcher) await watcher.close();
    },
  };
}

interface SourceRunner {
  schedule: (trigger: RefreshTrigger) => void;
  dispose: () => void;
}

function createSourceRunner(
  target: WatchedSource,
  deps: MultiSourceWatcherDeps,
): SourceRunner {
  const inChainViewIds = target.plan.views.map((v) => v.id);
  const labelPrefix = target.plan.id ? `@${target.plan.id}: ` : '';

  let pending: NodeJS.Timeout | undefined;
  let inFlight = false;
  let queued: RefreshTrigger | undefined;

  const rebuild = async (trigger: RefreshTrigger): Promise<void> => {
    if (inFlight) {
      queued = trigger;
      return;
    }
    inFlight = true;
    try {
      const refreshedIds =
        trigger.kind === 'file-change' ? inChainViewIds : [trigger.viewId];
      for (const id of refreshedIds) {
        deps.logger.log(
          `${labelPrefix}Refreshing view "${id}" (trigger: ${triggerLabel(trigger)})`,
        );
      }
      const start = Date.now();
      const refreshed = await resolveSource(target.target, {
        graphMode: deps.graphMode,
        registry: target.registry,
      });
      if (refreshed.mode === 'materialized') {
        target.storeRef.current = refreshed.store;
        target.onRebuiltFiles?.(refreshed.files);
        deps.logger.log(
          `${labelPrefix}Rebuilt store: ${refreshed.files.length} file(s), ${refreshed.store.size} quads in ${
            Date.now() - start
          }ms`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger.error(`${labelPrefix}Rebuild failed: ${message}`);
    } finally {
      inFlight = false;
      const next = queued;
      if (next) {
        queued = undefined;
        void rebuild(next);
      }
    }
  };

  const schedule = (trigger: RefreshTrigger): void => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = undefined;
      void rebuild(trigger);
    }, deps.debounceMs);
  };

  return {
    schedule,
    dispose: () => {
      if (pending) {
        clearTimeout(pending);
        pending = undefined;
      }
    },
  };
}

function pathBelongsToPlan(
  path: string,
  plan: WatcherSourcePlan,
): boolean {
  for (const base of plan.globBases) {
    if (path === base) return true;
    if (path.startsWith(base + sep)) return true;
    if (sep !== '/' && path.startsWith(base + '/')) return true;
  }
  return false;
}

interface ScheduledHandle {
  stop: () => void;
}

function startTtlTimers(
  views: ReadonlyArray<ParsedViewSource>,
  schedule: (trigger: RefreshTrigger) => void,
): ScheduledHandle {
  const timers: NodeJS.Timeout[] = [];
  for (const view of views) {
    if (view.cache?.strategy !== 'ttl') continue;
    const ttlMs = view.cache.ttlMs;
    const tick = (): void => {
      schedule({ kind: 'ttl', viewId: view.id });
    };
    const t = setInterval(tick, ttlMs);
    timers.push(t);
  }
  return {
    stop: () => {
      for (const t of timers) clearInterval(t);
    },
  };
}

function startFreshnessPolls(
  views: ReadonlyArray<ParsedViewSource>,
  registry: ReadonlyArray<ParsedSource>,
  pollMs: number,
  logger: Logger,
  schedule: (trigger: RefreshTrigger) => void,
): ScheduledHandle {
  const timers: NodeJS.Timeout[] = [];
  for (const view of views) {
    if (view.cache?.strategy !== 'freshness') continue;
    const askQuery = view.cache.freshness;
    let lastResult = true;
    const probe = async (): Promise<void> => {
      try {
        const result = await runAskAgainstUpstream(view, registry, askQuery);
        if (lastResult && !result) {
          schedule({ kind: 'freshness', viewId: view.id });
        }
        lastResult = result;
      } catch (err) {
        logger.error(
          `freshness probe failed for view "${view.id}": ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    };
    const t = setInterval(() => void probe(), pollMs);
    timers.push(t);
  }
  return {
    stop: () => {
      for (const t of timers) clearInterval(t);
    },
  };
}

async function runAskAgainstUpstream(
  view: ParsedViewSource,
  registry: ReadonlyArray<ParsedSource>,
  askQuery: string,
): Promise<boolean> {
  const byId = new Map<string, ParsedSource>();
  for (const src of registry) {
    if (src.kind === 'reference' || src.id === undefined) continue;
    byId.set(src.id, src);
  }
  const upstream = byId.get(view.from);
  if (!upstream) {
    throw new Error(
      `freshness watch: view "${view.id}" upstream "@${view.from}" is missing from the registry`,
    );
  }
  if (upstream.kind !== 'endpoint' && upstream.kind !== 'empty') {
    throw new Error(
      `freshness watch supports endpoint or empty upstreams; view "${view.id}" upstream is ${upstream.kind}`,
    );
  }
  const engine = new ComunicaQueryEngine();
  const source =
    upstream.kind === 'endpoint'
      ? { type: 'sparql', value: upstream.endpoint }
      : new Store();
  const result = await engine.query(askQuery, { sources: [source] });
  if (result.resultType !== 'boolean') {
    throw new Error(
      `cache.freshness query must be an ASK; got ${String(result.resultType)}`,
    );
  }
  return (await result.execute()) as boolean;
}

function unionFiles(
  perSource: Iterable<ReadonlyArray<string>>,
): string[] {
  const out: string[] = [];
  for (const files of perSource) {
    for (const f of files) out.push(f);
  }
  return out;
}

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

type Next = (err?: unknown) => void;

function sparqlQueryBodyParser(
  req: IncomingMessage & { body?: unknown },
  _res: ServerResponse,
  next: Next,
): void {
  const ct = (req.headers['content-type'] ?? '').toLowerCase();
  if (!ct.includes('application/sparql-query')) {
    next();
    return;
  }
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  req.on('end', () => {
    req.body = Buffer.concat(chunks).toString('utf8');
    next();
  });
  req.on('error', next);
}
