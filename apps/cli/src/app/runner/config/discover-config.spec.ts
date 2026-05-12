import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverConfig } from './discover-config';

describe('discoverConfig', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = realpathSync(await mkdtemp(join(tmpdir(), 'sparqly-discover-')));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('returns the absolute path of the nearest sparqly.config.yaml when walking up', async () => {
    const projectRoot = scratch;
    const sub = join(projectRoot, 'pkg', 'src');
    await mkdir(sub, { recursive: true });
    await mkdir(join(projectRoot, '.git'));
    const configPath = join(projectRoot, 'sparqly.config.yaml');
    await writeFile(configPath, 'sources: []\n');

    expect(discoverConfig({ cwd: sub })).toBe(configPath);
  });

  it('returns null when no config exists between cwd and the git root', async () => {
    const projectRoot = scratch;
    const sub = join(projectRoot, 'pkg', 'src');
    await mkdir(sub, { recursive: true });
    await mkdir(join(projectRoot, '.git'));

    expect(discoverConfig({ cwd: sub })).toBeNull();
  });

  it('does not look past the git root for a config', async () => {
    const outer = scratch;
    const project = join(outer, 'project');
    const sub = join(project, 'pkg');
    await mkdir(sub, { recursive: true });
    await mkdir(join(project, '.git'));
    // A "stranger" config sits outside the project's git root.
    await writeFile(join(outer, 'sparqly.config.yaml'), 'sources: []\n');

    expect(discoverConfig({ cwd: sub })).toBeNull();
  });

  it('errors when two config extensions coexist in the same directory', async () => {
    const projectRoot = scratch;
    await mkdir(join(projectRoot, '.git'));
    await writeFile(join(projectRoot, 'sparqly.config.yaml'), 'sources: []\n');
    await writeFile(join(projectRoot, 'sparqly.config.json'), '{"sources": []}');

    expect(() => discoverConfig({ cwd: projectRoot })).toThrow(
      /sparqly\.config\.(yaml|json).*sparqly\.config\.(yaml|json)/s,
    );
    expect(() => discoverConfig({ cwd: projectRoot })).toThrow(projectRoot);
  });

  it('returns the nearest match when an ancestor also has a config', async () => {
    const projectRoot = scratch;
    const inner = join(projectRoot, 'pkg');
    await mkdir(inner, { recursive: true });
    await mkdir(join(projectRoot, '.git'));
    await writeFile(join(projectRoot, 'sparqly.config.yaml'), 'sources: []\n');
    const innerConfig = join(inner, 'sparqly.config.yml');
    await writeFile(innerConfig, 'sources: []\n');

    expect(discoverConfig({ cwd: inner })).toBe(innerConfig);
  });
});
