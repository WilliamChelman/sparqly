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

const TEMP_DIR_INFIX = '.building-';
const REPLACED_INFIX = '.replaced-';
const MANIFEST_ENTRY = 'manifest.json';

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
          glob: Array.isArray(options.glob) ? options.glob : [options.glob],
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

async function prepare(indexDir: string, parent: string): Promise<void> {
  await mkdir(parent, { recursive: true });
  await sweepStaleTempDirs(indexDir, parent);
  await sweepReplacedOrphans(indexDir);
}

/** Active sweep for the cancel path; a cancelled rebuild may never be followed by another build. */
export async function sweepGlobIndexTempDirs(indexDir: string): Promise<void> {
  const parent = dirname(indexDir);
  try {
    await sweepStaleTempDirs(indexDir, parent);
    await sweepReplacedOrphans(indexDir);
  } catch {
    // Best-effort cleanup.
  }
}

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

/** Preserves temp dirs of live pids so overlapping builds aren't clobbered mid-ingest. */
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

function parseTempDirPid(suffix: string): number | undefined {
  const dash = suffix.indexOf('-');
  const raw = dash === -1 ? suffix : suffix.slice(0, dash);
  if (!/^\d+$/.test(raw)) return undefined;
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/** `process.kill(pid, 0)` probes without signalling; EPERM means alive but owned by another user. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Manifest is renamed last — it's the commit marker that makes the new index visible as fresh. */
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

/** Non-empty dirs (LevelDB's `db/`) need rename-aside-then-rename since `rename` would fail with ENOTEMPTY. */
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
