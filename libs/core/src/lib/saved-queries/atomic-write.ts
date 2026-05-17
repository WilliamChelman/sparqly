import { randomBytes } from 'node:crypto';
import { rename as fsRename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface AtomicWriteOptions {
  /**
   * Override the rename syscall — used by tests to inject a failure between
   * the temp-file write and the final swap so the on-disk invariant can be
   * verified.
   */
  rename?: (from: string, to: string) => Promise<void>;
}

/**
 * Write-temp-then-rename (ADR-0036). The temp file is written into the same
 * directory as the destination so `rename` is a same-filesystem operation and
 * stays atomic. If the rename fails, the temp file is unlinked so a partial
 * write never lingers next to the real sidecar.
 */
export async function atomicWriteFile(
  path: string,
  contents: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const dir = dirname(path);
  const tmpName = `.${randomBytes(8).toString('hex')}.tmp`;
  const tmpPath = join(dir, tmpName);
  await writeFile(tmpPath, contents, { encoding: 'utf8' });
  const rename = options.rename ?? fsRename;
  try {
    await rename(tmpPath, path);
  } catch (err) {
    await unlink(tmpPath).catch(() => undefined);
    throw err;
  }
}
