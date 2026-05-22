import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Manifest version token when the co-located package.json cannot be read. */
const FALLBACK_VERSION = '0.0.0+unknown';

/**
 * The running sparqly CLI version, recorded in a disk-backed glob's index
 * manifest (ADR-0041). Read from the `package.json` co-located with the
 * bundled entrypoint (webpack `generatePackageJson`); falls back to a token
 * when that file is absent — e.g. an unbundled `vitest` run of the source.
 */
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
