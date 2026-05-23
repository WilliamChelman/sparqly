import { randomBytes } from 'node:crypto';
import { rename as fsRename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface AtomicWriteOptions {
  /** Override the rename syscall — used by tests to inject failures. */
  rename?: (from: string, to: string) => Promise<void>;
}

// Temp file is written into the destination directory so `rename` stays a
// same-filesystem atomic swap. A failed rename unlinks the temp file.
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
