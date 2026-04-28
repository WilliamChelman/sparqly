import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, resolveConfig } from './resolve-config';

describe('resolveConfig', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-config-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty config and null filepath when no config file exists', async () => {
    const result = await resolveConfig({ cwd: dir, stopDir: dir });
    expect(result.config).toEqual({});
    expect(result.filepath).toBeNull();
  });

  it('discovers sparqly.config.yaml by walking up parent directories', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      'sources: "data/**/*.ttl"\ngraphStrategy: partial\n',
    );
    const sub = join(dir, 'a', 'b');
    await mkdir(sub, { recursive: true });

    const result = await resolveConfig({ cwd: sub, stopDir: dir });

    expect(result.filepath).toBe(join(dir, 'sparqly.config.yaml'));
    expect(result.config).toEqual({
      sources: 'data/**/*.ttl',
      graphStrategy: 'partial',
    });
  });

  it('reads sparqly.config.json', async () => {
    await writeFile(
      join(dir, 'sparqly.config.json'),
      JSON.stringify({ mutable: true, verbose: true }),
    );

    const result = await resolveConfig({ cwd: dir, stopDir: dir });

    expect(result.config).toEqual({ mutable: true, verbose: true });
  });

  it('loads an explicit --config path', async () => {
    const explicit = join(dir, 'custom.yaml');
    await writeFile(explicit, 'sources: "explicit/**/*.ttl"\n');

    const result = await resolveConfig({
      cwd: dir,
      stopDir: dir,
      configPath: explicit,
    });

    expect(result.filepath).toBe(explicit);
    expect(result.config.sources).toBe('explicit/**/*.ttl');
  });

  it('throws ConfigError when --config path does not exist', async () => {
    await expect(
      resolveConfig({
        cwd: dir,
        stopDir: dir,
        configPath: join(dir, 'missing.yaml'),
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it('throws ConfigError when a config file fails to parse', async () => {
    const bad = join(dir, 'bad.yaml');
    await writeFile(bad, ': : : not yaml ::\n');

    await expect(
      resolveConfig({ cwd: dir, stopDir: dir, configPath: bad }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it('throws ConfigError on a type mismatch with a clear message', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      'graphStrategy: 42\n',
    );

    let error: unknown;
    try {
      await resolveConfig({ cwd: dir, stopDir: dir });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toMatch(/graphStrategy/);
  });

  it('warns and continues on unknown keys', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      'sources: "data/**/*.ttl"\nbogusKey: "ignored"\n',
    );
    const warn = vi.fn();

    const result = await resolveConfig({ cwd: dir, stopDir: dir, warn });

    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toMatch(/bogusKey/);
    expect(result.config.sources).toBe('data/**/*.ttl');
  });

  it('rejects an invalid graphStrategy enum value with the offending value in the message', async () => {
    await writeFile(
      join(dir, 'sparqly.config.json'),
      JSON.stringify({ graphStrategy: 'bogus' }),
    );

    let error: unknown;
    try {
      await resolveConfig({ cwd: dir, stopDir: dir });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toMatch(/graphStrategy/);
  });
});
