import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { atomicWriteFile } from './atomic-write';

describe('atomicWriteFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-atomic-write-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the file contents on success', async () => {
    const path = join(dir, 'sidecar.yaml');
    await atomicWriteFile(path, 'savedQueries: {}\n');
    expect(await readFile(path, 'utf8')).toBe('savedQueries: {}\n');
  });

  it('replaces the existing file atomically and leaves no temp behind', async () => {
    const path = join(dir, 'sidecar.yaml');
    await writeFile(path, 'old\n');
    await atomicWriteFile(path, 'new\n');
    expect(await readFile(path, 'utf8')).toBe('new\n');
    const remaining = await readdir(dir);
    expect(remaining).toEqual(['sidecar.yaml']);
  });

  it('preserves the prior file when the rename step fails mid-write', async () => {
    const path = join(dir, 'sidecar.yaml');
    await writeFile(path, 'untouched\n');
    const failingRename = async (): Promise<never> => {
      throw new Error('injected rename failure');
    };
    await expect(
      atomicWriteFile(path, 'will-not-land\n', { rename: failingRename }),
    ).rejects.toThrow(/injected rename failure/);
    expect(await readFile(path, 'utf8')).toBe('untouched\n');
    // Temp file is cleaned up even on rename failure.
    const remaining = await readdir(dir);
    expect(remaining).toEqual(['sidecar.yaml']);
  });
});
