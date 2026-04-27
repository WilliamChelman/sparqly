import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type GraphStrategy, loadRdf } from 'core';
import { ServerModule } from './server.module';

export interface CreateServerOptions {
  sources: string | string[];
  port: number;
  mutable?: boolean;
  graphStrategy?: GraphStrategy;
  webRootDir?: string;
}

export interface CreatedServer {
  port: number;
  close: () => Promise<void>;
}

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

  const app = await NestFactory.create<NestExpressApplication>(
    ServerModule.forRoot({
      store,
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

  return {
    port: portFromUrl(url) ?? options.port,
    close: () => app.close(),
  };
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
