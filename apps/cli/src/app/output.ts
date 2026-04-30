import { randomBytes } from 'node:crypto';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

export interface WriteOutputToFileInput {
  out: string;
  cwd: string;
  body: string;
}

export async function writeOutputToFile(
  input: WriteOutputToFileInput,
): Promise<void> {
  if (input.out === '-') {
    throw new Error("--out '-' is not supported (use stdout instead)");
  }
  const target = isAbsolute(input.out)
    ? input.out
    : resolve(input.cwd, input.out);
  try {
    const s = await stat(target);
    if (s.isDirectory()) {
      throw new Error(`--out path is a directory: ${target}`);
    }
  } catch (err) {
    if (!isENOENT(err)) throw err;
  }
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp.${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(tmp, input.body);
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

function isENOENT(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'ENOENT'
  );
}
