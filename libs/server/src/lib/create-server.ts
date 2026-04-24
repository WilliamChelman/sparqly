import { NestFactory } from '@nestjs/core';
import { ServerModule } from './server.module';

export interface CreateServerOptions {
  port: number;
}

export async function createServer(options: CreateServerOptions): Promise<void> {
  const app = await NestFactory.create(ServerModule, { logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api');
  await app.listen(options.port);
}
