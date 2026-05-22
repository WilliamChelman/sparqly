import { stat } from 'node:fs/promises';
import type { SparqlyLogger } from 'common';
import { storageTier } from './glob-storage';
import type { ParsedGlobSource } from './source-spec';

/**
 * Soft byte-hint threshold (ADR-0041): when an un-flagged glob's matched files
 * total more than this, `serve` warns that the source should consider
 * `storage: disk`. Picked at 256 MiB — that much matched RDF text inflates to
 * roughly 1–1.5 GB of V8 heap once parsed into an `n3.Store` plus the
 * unconditional source-record sidecar, which is well into out-of-memory-risk
 * territory yet far above any normal small-glob use, so the warning is
 * actionable without crying wolf.
 */
export const OVERSIZED_GLOB_HINT_BYTES = 256 * 1024 * 1024;

export interface OversizedGlobHintDeps {
  /** Boundary logger (ADR-0020) the hint is emitted through. */
  logger: SparqlyLogger;
  /**
   * Threshold override in bytes. Defaults to {@link OVERSIZED_GLOB_HINT_BYTES}.
   * Exists so tests can exercise the hint against small fixtures.
   */
  thresholdBytes?: number;
}

const MIB = 1024 * 1024;

function asMib(bytes: number): string {
  return `${Math.round(bytes / MIB)} MiB`;
}

/**
 * Emits one `warn`-level boundary log line when an un-flagged glob's matched
 * files total more than the soft byte hint, pointing the user at
 * `storage: disk` (ADR-0041). Inspects file sizes only — never reads or parses
 * file contents — so it rides `serve`'s eager glob-path enumeration cheaply.
 */
export async function warnIfOversizedGlob(
  source: ParsedGlobSource,
  paths: ReadonlyArray<string>,
  deps: OversizedGlobHintDeps,
): Promise<void> {
  // A glob already on the disk tier needs no hint — it is the fix itself.
  if (storageTier(source) === 'disk') return;
  const threshold = deps.thresholdBytes ?? OVERSIZED_GLOB_HINT_BYTES;
  let bytes = 0;
  for (const path of paths) {
    // A discoverability hint must never crash `serve` boot: a file that
    // vanished between enumeration and stat (or a pinned-glob path absent
    // from the working tree) just contributes nothing to the total.
    try {
      bytes += (await stat(path)).size;
    } catch {
      // skip — unreadable file size cannot be counted
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
