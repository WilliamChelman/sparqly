import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConfigError, makeFileLoader } from './file-loader';
import type { FieldDescriptor } from './field';
import type { CommandSpec } from './spec';

const sourcesField: FieldDescriptor = {
  key: 'sources',
  schema: z.union([z.string(), z.array(z.string()).min(1)]),
};

const portField: FieldDescriptor = {
  key: 'port',
  schema: z.number().int(),
};

const querySpec: CommandSpec = {
  name: 'query',
  description: 'q',
  fields: [sourcesField],
  handler: () => undefined,
  exitCode: () => 1,
};

const serveSpec: CommandSpec = {
  name: 'serve',
  description: 's',
  fields: [sourcesField, portField],
  handler: () => undefined,
  exitCode: () => 1,
};

describe('makeFileLoader', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-loader-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('parses YAML into a flat per-command data bag', async () => {
    const path = join(dir, 'sparqly.query.yaml');
    await writeFile(path, 'sources: "data/**/*.ttl"\n');

    const load = makeFileLoader(querySpec);
    const result = await load(path, dir);

    expect(result).toEqual({
      data: { sources: 'data/**/*.ttl' },
      filepath: path,
    });
  });

  it('parses JSON when extension is .json', async () => {
    const path = join(dir, 'sparqly.serve.json');
    await writeFile(path, JSON.stringify({ port: 8080 }));

    const load = makeFileLoader(serveSpec);
    const result = await load(path, dir);

    expect(result.data).toEqual({ port: 8080 });
    expect(result.filepath).toBe(path);
  });

  it('rejects unknown top-level keys (strict)', async () => {
    const path = join(dir, 'sparqly.query.yaml');
    await writeFile(path, 'sources: "x"\nbogus: 1\n');

    const load = makeFileLoader(querySpec);
    await expect(load(path, dir)).rejects.toBeInstanceOf(ConfigError);
    await expect(load(path, dir)).rejects.toThrow(/bogus/);
  });

  it('reports type mismatches with the file path', async () => {
    const path = join(dir, 'sparqly.serve.yaml');
    await writeFile(path, 'port: "abc"\n');

    const load = makeFileLoader(serveSpec);
    await expect(load(path, dir)).rejects.toThrow(path);
    await expect(load(path, dir)).rejects.toThrow(/port/);
  });

  it('hard-errors on a missing file', async () => {
    const path = join(dir, 'does-not-exist.yaml');

    const load = makeFileLoader(querySpec);
    await expect(load(path, dir)).rejects.toBeInstanceOf(ConfigError);
    await expect(load(path, dir)).rejects.toThrow(path);
  });

  it('hard-errors on malformed YAML', async () => {
    const path = join(dir, 'broken.yaml');
    await writeFile(path, 'sources: "unterminated\n');

    const load = makeFileLoader(querySpec);
    await expect(load(path, dir)).rejects.toBeInstanceOf(ConfigError);
  });

  it('rejects unsupported extensions', async () => {
    const path = join(dir, 'config.toml');
    await writeFile(path, 'sources = "x"\n');

    const load = makeFileLoader(querySpec);
    await expect(load(path, dir)).rejects.toThrow(/unsupported extension/);
  });

  it('rejects an array root with a clear message', async () => {
    const path = join(dir, 'arr.yaml');
    await writeFile(path, '- 1\n- 2\n');

    const load = makeFileLoader(querySpec);
    await expect(load(path, dir)).rejects.toThrow(/array/);
  });

  it('resolves relative paths against cwd', async () => {
    await writeFile(join(dir, 'rel.yaml'), 'sources: "x"\n');

    const load = makeFileLoader(querySpec);
    const result = await load('rel.yaml', dir);
    expect(result.filepath).toBe(join(dir, 'rel.yaml'));
  });
});
