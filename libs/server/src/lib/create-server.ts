import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, resolve } from 'node:path';
import * as chokidar from 'chokidar';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { Store } from 'n3';
import {
  type GraphMode,
  loadQuerySources,
  loadSources,
  parseSourceSpecs,
  type ParsedSource,
  type ParsedViewSource,
  QueryEngine,
  type SourceSpecInput,
} from 'core';
import { ServerModule } from './server.module';
import type { StoreRef } from './tokens';

export interface CreateServerOptions {
  sources: SourceSpecInput | ReadonlyArray<SourceSpecInput>;
  port: number;
  mutable?: boolean;
  graphMode?: GraphMode;
  webRootDir?: string;
  watch?: boolean;
  watchDebounceMs?: number;
  watchPollMs?: number;
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
  const loadStart = Date.now();
  const querySources = await loadQuerySources(inputs, {
    graphMode: options.graphMode,
  });

  let engine: QueryEngine;
  let storeRef: StoreRef | undefined;
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
  }

  const app = await NestFactory.create<NestExpressApplication>(
    ServerModule.forRoot({
      engine,
      config: { mutable: options.mutable === true },
    }),
    { abortOnError: false },
  );
  app.setGlobalPrefix('api');
  app.use(sparqlQueryBodyParser);

  if (options.webRootDir) {
    app.useStaticAssets(options.webRootDir, { index: ['index.html'] });
  }

  await app.listen(options.port);
  const url = await app.getUrl();
  logger.log(`SPARQL endpoint listening at ${url}/api/sparql`);
  if (options.webRootDir) {
    logger.log(`Web playground served at ${url}/`);
  }

  const watcher = options.watch
    ? await maybeStartWatcher({
        sources: inputs,
        graphMode: options.graphMode,
        storeRef,
        logger,
        debounceMs: options.watchDebounceMs ?? DEFAULT_DEBOUNCE_MS,
        pollMs: options.watchPollMs ?? DEFAULT_POLL_MS,
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
  | { kind: 'file-change' }
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

interface StartWatcherOptions {
  sources: ReadonlyArray<SourceSpecInput>;
  graphMode?: GraphMode;
  storeRef: StoreRef | undefined;
  logger: Logger;
  debounceMs: number;
  pollMs: number;
}

async function maybeStartWatcher(
  opts: StartWatcherOptions,
): Promise<WatcherHandle | undefined> {
  const parsed = parseSourceSpecs(opts.sources);
  const globPatterns = parsed
    .filter((s): s is Extract<typeof s, { kind: 'glob' }> => s.kind === 'glob')
    .map((s) => s.glob);
  const views = parsed.filter(
    (s): s is ParsedViewSource => s.kind === 'view',
  );

  if (globPatterns.length === 0 || !opts.storeRef) {
    opts.logger.warn(
      '--watch ignored: no glob source to watch. SPARQL sources are not auto-refreshed; restart the process to pick up upstream changes.',
    );
    return undefined;
  }

  return startWatcher(
    { ...opts, storeRef: opts.storeRef },
    globPatterns,
    views,
    parsed,
  );
}

async function startWatcher(
  opts: StartWatcherOptions & { storeRef: StoreRef },
  globPatterns: ReadonlyArray<string>,
  views: ReadonlyArray<ParsedViewSource>,
  registry: ReadonlyArray<ParsedSource>,
): Promise<WatcherHandle> {
  const viewIds = views.map((v) => v.id);
  const baseDirs = Array.from(new Set(globPatterns.map((p) => globBase(p))));

  const watcher = chokidar.watch(baseDirs, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
  });

  await new Promise<void>((resolveReady, rejectReady) => {
    const onReady = (): void => {
      watcher.off('error', onError);
      resolveReady();
    };
    const onError = (err: unknown): void => {
      watcher.off('ready', onReady);
      rejectReady(err instanceof Error ? err : new Error(String(err)));
    };
    watcher.once('ready', onReady);
    watcher.once('error', onError);
  });

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
        trigger.kind === 'file-change' ? viewIds : [trigger.viewId];
      for (const id of refreshedIds) {
        opts.logger.log(
          `Refreshing view "${id}" (trigger: ${triggerLabel(trigger)})`,
        );
      }
      const start = Date.now();
      const { store, files } = await loadSources(opts.sources, {
        graphMode: opts.graphMode,
      });
      opts.storeRef.current = store;
      opts.logger.log(
        `Rebuilt store: ${files.length} file(s), ${store.size} quads in ${
          Date.now() - start
        }ms`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.logger.error(`Rebuild failed: ${message}`);
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
    }, opts.debounceMs);
  };

  const onFileEvent = (): void => schedule({ kind: 'file-change' });
  watcher.on('add', onFileEvent);
  watcher.on('change', onFileEvent);
  watcher.on('unlink', onFileEvent);

  const ttlTimers = startTtlTimers(views, schedule);
  const freshnessPolls = startFreshnessPolls(
    views,
    registry,
    opts.pollMs,
    opts.logger,
    schedule,
  );

  return {
    close: async () => {
      if (pending) {
        clearTimeout(pending);
        pending = undefined;
      }
      ttlTimers.stop();
      freshnessPolls.stop();
      await watcher.close();
    },
  };
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

function globBase(pattern: string): string {
  const isAbs = isAbsolute(pattern);
  const segments = pattern.split(/[\\/]+/);
  const out: string[] = [];
  for (const seg of segments) {
    if (/[*?[\]{}!()]/.test(seg)) break;
    out.push(seg);
  }
  const joined = out.join('/');
  if (joined === '' || joined === '.') return resolve('.');
  if (!isAbs) return resolve(joined);
  if (out.length === 1 && out[0] === '') return '/';
  return joined;
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
