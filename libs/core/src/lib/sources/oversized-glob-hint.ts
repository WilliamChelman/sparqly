import { stat } from 'node:fs/promises';
import type { SparqlyLogger } from 'common';
import { storageTier } from './glob-storage';
import type { ParsedGlobSource } from './source-spec';

// 256 MiB of matched RDF text inflates to ~1–1.5 GB of V8 heap once parsed.
export const OVERSIZED_GLOB_HINT_BYTES = 256 * 1024 * 1024;

export interface OversizedGlobHintDeps {
  logger: SparqlyLogger;
  /** Override in bytes; exists so tests can exercise the hint against small fixtures. */
  thresholdBytes?: number;
}

const MIB = 1024 * 1024;

function asMib(bytes: number): string {
  return `${Math.round(bytes / MIB)} MiB`;
}

export async function warnIfOversizedGlob(
  source: ParsedGlobSource,
  paths: ReadonlyArray<string>,
  deps: OversizedGlobHintDeps,
): Promise<void> {
  if (storageTier(source) === 'disk') return;
  const threshold = deps.thresholdBytes ?? OVERSIZED_GLOB_HINT_BYTES;
  let bytes = 0;
  for (const path of paths) {
    // A hint must never crash boot: a missing file just contributes nothing.
    try {
      bytes += (await stat(path)).size;
    } catch {
      // unreadable — skip
    }
  }
  if (bytes <= threshold) return;
  deps.logger.warn(
    `Glob ${JSON.stringify(source.glob)} matched ${asMib(bytes)} across ` +
      `${paths.length} files, over the ${asMib(threshold)} in-memory hint. ` +
      'Set `storage: disk` on this source to materialize it on disk and ' +
      'avoid an out-of-memory crash.',
    { glob: source.glob, bytes, files: paths.length, thresholdBytes: threshold },
  );
}
