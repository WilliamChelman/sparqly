import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, resolve } from 'node:path';
import * as chokidar from 'chokidar';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type GraphStrategy, loadRdf } from 'core';
import { ServerModule } from './server.module';
import type { StoreRef } from './tokens';

export interface CreateServerOptions {
  sources: string | string[];
  port: number;
  mutable?: boolean;
  graphStrategy?: GraphStrategy;
  webRootDir?: string;
  watch?: boolean;
  watchDebounceMs?: number;
}

export interface CreatedServer {
  port: number;
  close: () => Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 250;

export async function createServer(
  options: CreateServerOptions,
): Promise<CreatedServer> {
  const logger = new Logger('sparqly');
  const loadStart = Date.now();
  const { store, files } = await loadRdf({
    sources: options.sources,
    graphStrategy: options.graphStrategy,
  });
  logger.log(
    `Loaded ${files.length} file(s) (${store.size} quads) in ${
      Date.now() - loadStart
    }ms`,
  );

  const storeRef: StoreRef = { current: store };

  const app = await NestFactory.create<NestExpressApplication>(
    ServerModule.forRoot({
      storeRef,
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
    ? await startWatcher({
        sources: options.sources,
        graphStrategy: options.graphStrategy,
        storeRef,
        logger,
        debounceMs: options.watchDebounceMs ?? DEFAULT_DEBOUNCE_MS,
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

interface WatcherHandle {
  close: () => Promise<void>;
}

interface StartWatcherOptions {
  sources: string | string[];
  graphStrategy?: GraphStrategy;
  storeRef: StoreRef;
  logger: Logger;
  debounceMs: number;
}

async function startWatcher(
  opts: StartWatcherOptions,
): Promise<WatcherHandle> {
  const patterns = Array.isArray(opts.sources) ? opts.sources : [opts.sources];
  const baseDirs = Array.from(
    new Set(patterns.map((p) => globBase(p))),
  );

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
  let queued = false;

  const rebuild = async (): Promise<void> => {
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    try {
      const start = Date.now();
      const { store, files } = await loadRdf({
        sources: opts.sources,
        graphStrategy: opts.graphStrategy,
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
      if (queued) {
        queued = false;
        void rebuild();
      }
    }
  };

  const schedule = (): void => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = undefined;
      void rebuild();
    }, opts.debounceMs);
  };

  watcher.on('add', schedule);
  watcher.on('change', schedule);
  watcher.on('unlink', schedule);

  return {
    close: async () => {
      if (pending) {
        clearTimeout(pending);
        pending = undefined;
      }
      await watcher.close();
    },
  };
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
