import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Manifest version token when the co-located package.json cannot be read. */
const FALLBACK_VERSION = '0.0.0+unknown';

// Read from the bundled-entrypoint package.json (webpack `generatePackageJson`);
// falls back to a token when that file is absent (e.g. unbundled vitest runs).
export function cliVersion(): string {
  try {
    const raw = readFileSync(join(__dirname, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === 'string' && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {
    // No co-located package.json (unbundled run) — fall through.
  }
  return FALLBACK_VERSION;
}
