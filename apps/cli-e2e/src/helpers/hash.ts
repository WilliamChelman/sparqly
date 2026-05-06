import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const HASH_FIXTURES = resolve(HERE, '../../fixtures/hash');
const DIFF_FIXTURES = resolve(HERE, '../../fixtures/diff');
const FORMAT_FIXTURES = resolve(HERE, '../../fixtures/format');

export function hashFixture(...segments: string[]): string {
  return resolve(HASH_FIXTURES, ...segments);
}

export function diffFixture(...segments: string[]): string {
  return resolve(DIFF_FIXTURES, ...segments);
}

export function formatFixture(...segments: string[]): string {
  return resolve(FORMAT_FIXTURES, ...segments);
}

export function leadingHash(line: string): string {
  return line.split('  ')[0];
}

export function nonEmptyLines(text: string): string[] {
  return text.split('\n').filter((l) => l.length > 0);
}

/**
 * Body lines with the leading `# left=L right=R +x -y` summary stripped —
 * used by diff e2e tests so they don't have to thread the summary through
 * every length assertion. Other `#` comments (turtle's `# --- removed ---`,
 * `# from path:line`) are preserved.
 */
export function diffBodyLines(text: string): string[] {
  return nonEmptyLines(text).filter((l) => !/^# left=\d+ right=\d+ /.test(l));
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hashLineRe(source: string): RegExp {
  return new RegExp(`^[0-9a-f]{64} {2}${escapeRe(source)}$`);
}
