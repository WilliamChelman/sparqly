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

/** Infix marking an old artifact set aside mid-swap, e.g. `<entry>.replaced-<pid>-<rand>`. */
const REPLACED_INFIX = '.replaced-';

/** Filename of the manifest written by {@link buildGlobIndex}. */
const MANIFEST_ENTRY = 'manifest.json';

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
      ResultAsync.fromPromise(
        promote(tempDir, options.indexDir, built),
        (error): GlobLoadError => ({
          kind: 'glob-load',
          glob: [options.glob],
          message: `failed to promote glob index into place: ${(error as Error).message}`,
        }),
      ),
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
  await sweepReplacedOrphans(indexDir);
}

/**
 * Removes `<entry>.replaced-<pid>-*` orphans inside `indexDir` left by a build
 * that crashed mid-swap (between {@link promote}'s rename-aside and the new
 * rename-into-place). Each orphan holds the prior version of one entry; once
 * the build that owned them is dead, they're disk junk taking up space.
 */
async function sweepReplacedOrphans(indexDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(indexDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const cut = entry.indexOf(REPLACED_INFIX);
    if (cut === -1) continue;
    const pid = parseTempDirPid(entry.slice(cut + REPLACED_INFIX.length));
    if (pid !== undefined && isPidAlive(pid)) continue;
    await rm(join(indexDir, entry), { recursive: true, force: true });
  }
}

/**
 * Removes every `<indexDir>.building-*` sibling whose owning pid is no longer
 * alive — each the partial output of a build for this same source that was
 * interrupted before its atomic rename. Temp dirs owned by a live pid are
 * preserved, so an overlapping build (e.g. `IndexBuildPool` spawning while a
 * manual `sparqly index` runs) is never clobbered mid-ingest.
 */
async function sweepStaleTempDirs(
  indexDir: string,
  parent: string,
): Promise<void> {
  const prefix = basename(indexDir) + TEMP_DIR_INFIX;
  for (const entry of await readdir(parent)) {
    if (!entry.startsWith(prefix)) continue;
    const pid = parseTempDirPid(entry.slice(prefix.length));
    if (pid !== undefined && isPidAlive(pid)) continue;
    await rm(join(parent, entry), { recursive: true, force: true });
  }
}

/** Extracts the pid from the `<pid>-<rand>` suffix of a temp dir name. */
function parseTempDirPid(suffix: string): number | undefined {
  const dash = suffix.indexOf('-');
  const raw = dash === -1 ? suffix : suffix.slice(0, dash);
  if (!/^\d+$/.test(raw)) return undefined;
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/**
 * `process.kill(pid, 0)` doesn't signal — it probes the pid. ESRCH means the
 * process is gone; EPERM means it exists but this process can't signal it
 * (still alive, just owned by another user).
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Atomic-renames each artifact written by the build onto its real path,
 * replacing any prior version in place. Only the entries this build produced
 * are touched — anything else already in `indexDir` (e.g. a nested split-glob
 * child index at `<indexDir>/<file>/`) is preserved.
 *
 * Each replacement goes through {@link renameReplace}: a single `rename` for
 * regular files (atomic on POSIX) and a rename-aside-then-rename-into-place
 * swap for non-empty directories — so the real path is never absent mid-swap
 * and a `serve` process's open LevelDB inodes survive the rebuild. The
 * manifest is renamed *last* (it's the commit marker that makes the new
 * index visible as fresh); a crash mid-promote before that final rename
 * leaves the old manifest in place and the next open detects the source
 * drift and triggers a rebuild.
 */
async function promote(
  tempDir: string,
  indexDir: string,
  built: GlobIndexBuildResult,
): Promise<GlobIndexBuildResult> {
  await mkdir(indexDir, { recursive: true });
  const entries = await readdir(tempDir);
  const ordered = [
    ...entries.filter((e) => e !== MANIFEST_ENTRY),
    ...entries.filter((e) => e === MANIFEST_ENTRY),
  ];
  for (const entry of ordered) {
    await renameReplace(join(tempDir, entry), join(indexDir, entry));
  }
  await rm(tempDir, { recursive: true, force: true });
  return { indexDir, files: built.files };
}

/**
 * Replaces `target` with `src` using `rename(2)` semantics so the real path is
 * never absent at any point. For a regular file or an empty target dir,
 * POSIX `rename` atomically swaps in place. For a non-empty target dir
 * (LevelDB's `db/`), `rename` would fail with ENOTEMPTY/EEXIST — we move the
 * old dir to a sibling `<target>.replaced-<pid>-<rand>` then rename the new
 * one into place. A crash between the two renames leaves the old data
 * recoverable at the sibling (swept on the next build); a failure of the
 * second rename restores the old target before re-throwing.
 */
async function renameReplace(src: string, target: string): Promise<void> {
  try {
    await rename(src, target);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error;
  }
  const backup = `${target}${REPLACED_INFIX}${process.pid}-${randomBytes(6).toString('hex')}`;
  await rename(target, backup);
  try {
    await rename(src, target);
  } catch (error) {
    await rename(backup, target).catch(() => undefined);
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
}
