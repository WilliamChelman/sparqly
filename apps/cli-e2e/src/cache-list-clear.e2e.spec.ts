import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

interface SeedEntryOptions {
  id: string;
  strategy: 'ttl' | 'everlasting' | 'freshness';
  key: string;
  storedAt?: number;
  ttlMs?: number;
}

async function seedCacheEntry(
  cacheDir: string,
  opts: SeedEntryOptions,
): Promise<void> {
  const meta: Record<string, unknown> = {
    strategy: opts.strategy,
    id: opts.id,
    key: opts.key,
    storedAt: opts.storedAt ?? Date.now(),
  };
  if (opts.strategy === 'ttl') meta.ttlMs = opts.ttlMs ?? 3_600_000;
  await writeFile(
    join(cacheDir, `${opts.key}.meta.json`),
    JSON.stringify(meta),
  );
  // Minimal valid n-quads file; one quad keeps the file non-empty so size > 0.
  await writeFile(
    join(cacheDir, `${opts.key}.nq`),
    '<http://example.org/s> <http://example.org/p> <http://example.org/o> .\n',
  );
}

describe('sparqly cache list', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'sparqly-cache-list-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('exits 0 with empty stdout when the cacheDir has no entries', async () => {
    const result = await runCli([
      'cache',
      'list',
      '--cache-dir',
      cacheDir,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('reports each populated entry with id, strategy, size, age and freshness', async () => {
    await seedCacheEntry(cacheDir, {
      id: 'people',
      strategy: 'ttl',
      key: 'aaa111',
      storedAt: Date.now() - 1000,
      ttlMs: 3_600_000,
    });
    await seedCacheEntry(cacheDir, {
      id: 'archive',
      strategy: 'everlasting',
      key: 'bbb222',
    });

    const result = await runCli([
      'cache',
      'list',
      '--cache-dir',
      cacheDir,
    ]);

    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(2);
    const ids = lines.map((l) => l.split('\t')[0]).sort();
    expect(ids).toEqual(['archive', 'people']);
    for (const line of lines) {
      const cols = line.split('\t');
      expect(cols).toHaveLength(5);
      // strategy column
      expect(['ttl', 'everlasting', 'freshness']).toContain(cols[1]);
      // size column ends with byte unit
      expect(cols[2]).toMatch(/^\d+(\.\d+)?(B|KiB|MiB)$/);
      // freshness column
      expect(['fresh', 'stale']).toContain(cols[4]);
    }
  });
});

describe('sparqly cache clear', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'sparqly-cache-clear-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('removes every entry under cacheDir when no id is given', async () => {
    await seedCacheEntry(cacheDir, {
      id: 'people',
      strategy: 'ttl',
      key: 'aaa111',
    });
    await seedCacheEntry(cacheDir, {
      id: 'archive',
      strategy: 'everlasting',
      key: 'bbb222',
    });

    const result = await runCli([
      'cache',
      'clear',
      '--cache-dir',
      cacheDir,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const remaining = await readdir(cacheDir);
    expect(remaining).toEqual([]);
  });

  it('removes only the named entry when an id is given', async () => {
    await seedCacheEntry(cacheDir, {
      id: 'people',
      strategy: 'ttl',
      key: 'aaa111',
    });
    await seedCacheEntry(cacheDir, {
      id: 'archive',
      strategy: 'everlasting',
      key: 'bbb222',
    });

    const result = await runCli([
      'cache',
      'clear',
      'people',
      '--cache-dir',
      cacheDir,
    ]);

    expect(result.exitCode).toBe(0);
    const remaining = (await readdir(cacheDir)).sort();
    expect(remaining).toEqual(['bbb222.meta.json', 'bbb222.nq']);
  });

  it('exits non-zero with a clear error when the id is unknown', async () => {
    await seedCacheEntry(cacheDir, {
      id: 'people',
      strategy: 'ttl',
      key: 'aaa111',
    });

    const result = await runCli([
      'cache',
      'clear',
      'nope',
      '--cache-dir',
      cacheDir,
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/no cached entry with id "nope"/);
    expect(result.stderr).toMatch(/known: people/);
    // The known entry must be untouched.
    const remaining = (await readdir(cacheDir)).sort();
    expect(remaining).toEqual(['aaa111.meta.json', 'aaa111.nq']);
  });

  it('exits 0 with empty stderr when the cacheDir is already empty', async () => {
    const result = await runCli([
      'cache',
      'clear',
      '--cache-dir',
      cacheDir,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });
});
