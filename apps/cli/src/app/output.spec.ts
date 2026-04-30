import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeOutputToFile } from './output';

describe('writeOutputToFile', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-output-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('writes the body to the resolved path', async () => {
    const target = join(scratch, 'out.txt');
    await writeOutputToFile({ out: target, cwd: scratch, body: 'hello\n' });
    expect(await readFile(target, 'utf8')).toBe('hello\n');
  });

  it("rejects '-' with a clear error", async () => {
    await expect(
      writeOutputToFile({ out: '-', cwd: scratch, body: 'x' }),
    ).rejects.toThrow(/--out '-' is not supported/);
  });

  it('creates missing parent directories (mkdir -p)', async () => {
    const target = join(scratch, 'a', 'b', 'c', 'out.txt');
    await writeOutputToFile({ out: target, cwd: scratch, body: 'nested\n' });
    expect(await readFile(target, 'utf8')).toBe('nested\n');
  });

  it('resolves a relative path against the supplied cwd', async () => {
    await writeOutputToFile({ out: 'sub/out.txt', cwd: scratch, body: 'rel\n' });
    expect(await readFile(join(scratch, 'sub', 'out.txt'), 'utf8')).toBe(
      'rel\n',
    );
  });

  it('silently overwrites an existing file', async () => {
    const target = join(scratch, 'out.txt');
    await writeFile(target, 'old content');
    await writeOutputToFile({ out: target, cwd: scratch, body: 'new\n' });
    expect(await readFile(target, 'utf8')).toBe('new\n');
  });

  it('rejects when target is an existing directory', async () => {
    const dir = join(scratch, 'a-dir');
    await mkdir(dir);
    await expect(
      writeOutputToFile({ out: dir, cwd: scratch, body: 'x' }),
    ).rejects.toThrow(/--out path is a directory: .*a-dir/);
  });
});
