import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const HASH_FIXTURES = resolve(HERE, '../../fixtures/hash');
const DIFF_FIXTURES = resolve(HERE, '../../fixtures/diff');

export function hashFixture(...segments: string[]): string {
  return resolve(HASH_FIXTURES, ...segments);
}

export function diffFixture(...segments: string[]): string {
  return resolve(DIFF_FIXTURES, ...segments);
}

export function leadingHash(line: string): string {
  return line.split('  ')[0];
}

export function nonEmptyLines(text: string): string[] {
  return text.split('\n').filter((l) => l.length > 0);
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hashLineRe(source: string): RegExp {
  return new RegExp(`^[0-9a-f]{64} {2}${escapeRe(source)}$`);
}
