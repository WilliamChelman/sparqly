import {
  createServer,
  type CreateServerOptions,
  type CreatedServer,
} from './create-server';

export type { CreateServerOptions, CreatedServer } from './create-server';

/**
 * Boots a server for integration specs, unwrapping `createServer`'s `Result`
 * (ADR-0024). Use this when a spec asserts a successful boot; for error-path
 * assertions call `createServer` directly and match the `err`.
 */
export async function createTestServer(
  options: CreateServerOptions,
): Promise<CreatedServer> {
  return (await createServer(options))._unsafeUnwrap();
}
