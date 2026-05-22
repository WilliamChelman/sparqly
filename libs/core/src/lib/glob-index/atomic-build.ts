import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { ResultAsync, errAsync } from 'neverthrow';
import type { GlobLoadError } from '../sources/errors';
import {
  buildGlobIndex,
  type BuildGlobIndexOptions,
  type GlobIndexBuildResult,
} from './glob-index-builder';

/**
 * Atomic-rename Glob index build (#346, ADR-0042). Wraps {@link buildGlobIndex}
 * so a build never leaves a half-index at the real index path: every quad and
 * the manifest are written under a unique temp dir, and only once the manifest
 * has landed is that dir atomic-renamed onto `indexDir`. A build interrupted
 * before the rename — a crash, an OOM, a SIGKILL — leaves the real path
 * untouched; its partial temp dir is swept on the next build of the same
 * source.
 */

/** Infix marking a temp build dir, e.g. `<indexDir>.building-<pid>-<rand>`. */
const TEMP_DIR_INFIX = '.building-';

/**
 * Builds the Glob index for `options.glob` and atomic-renames it onto
 * `options.indexDir`. Sweeps any stale temp dirs left by a prior interrupted
 * build first, then streams the index into a fresh temp dir; the rename runs
 * only after {@link buildGlobIndex} has written the manifest. A failed build
 * drops its temp dir and propagates the {@link GlobLoadError} — the real index
 * path, and any index already there, is left as-is.
 */
export function buildGlobIndexAtomic(
  options: BuildGlobIndexOptions,
): ResultAsync<GlobIndexBuildResult, GlobLoadError> {
  const parent = dirname(options.indexDir);
  const tempDir = join(
    parent,
    `${basename(options.indexDir)}${TEMP_DIR_INFIX}${process.pid}-${randomBytes(6).toString('hex')}`,
  );
  return ResultAsync.fromSafePromise(prepare(options.indexDir, parent))
    .andThen(() => buildGlobIndex({ ...options, indexDir: tempDir }))
    .andThen((built) =>
      ResultAsync.fromSafePromise(promote(tempDir, options.indexDir, built)),
    )
    .orElse((error) =>
      ResultAsync.fromSafePromise(
        rm(tempDir, { recursive: true, force: true }),
      ).andThen(() => errAsync<GlobIndexBuildResult, GlobLoadError>(error)),
    );
}

/** Ensures the index parent exists and sweeps stale temp dirs before a build. */
async function prepare(indexDir: string, parent: string): Promise<void> {
  await mkdir(parent, { recursive: true });
  await sweepStaleTempDirs(indexDir, parent);
}

/**
 * Removes every `<indexDir>.building-*` sibling — each the partial output of a
 * build for this same source that was interrupted before its atomic rename.
 */
async function sweepStaleTempDirs(
  indexDir: string,
  parent: string,
): Promise<void> {
  const prefix = basename(indexDir) + TEMP_DIR_INFIX;
  for (const entry of await readdir(parent)) {
    if (entry.startsWith(prefix)) {
      await rm(join(parent, entry), { recursive: true, force: true });
    }
  }
}

/**
 * Atomic-renames each artifact written by the build onto its real path,
 * replacing any prior version in place. Only the entries this build produced
 * are touched — anything else already in `indexDir` (e.g. a nested split-glob
 * child index at `<indexDir>/<file>/`) is preserved.
 */
async function promote(
  tempDir: string,
  indexDir: string,
  built: GlobIndexBuildResult,
): Promise<GlobIndexBuildResult> {
  await mkdir(indexDir, { recursive: true });
  for (const entry of await readdir(tempDir)) {
    const target = join(indexDir, entry);
    await rm(target, { recursive: true, force: true });
    await rename(join(tempDir, entry), target);
  }
  await rm(tempDir, { recursive: true, force: true });
  return { indexDir, files: built.files };
}
