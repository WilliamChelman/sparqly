import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const QUERY_FIXTURES = resolve(HERE, '../../fixtures/query');

export function queryFixture(...segments: string[]): string {
  return resolve(QUERY_FIXTURES, ...segments);
}
