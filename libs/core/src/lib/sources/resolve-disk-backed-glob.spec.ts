import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryEngine } from '../engine';
import { resolveSourceResult } from './resolve-source-result';
import { parseSourceSpec } from './source-spec';

/**
 * Config-overridable Glob index cache location (ADR-0041, #345). A
 * `storage: disk` glob's index lives under `<configDir>/.sparqly/index/<id>/`
 * by default; an `indexCacheDir` override redirects the cache root so the
 * index lands at `<override>/<id>/` instead — letting a user place a large
 * index on a chosen volume.
 */
describe('disk-backed glob — index cache location', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-index-cache-'));
    await mkdir(join(dir, 'data'));
    await writeFile(
      join(dir, 'data', 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function diskGlob() {
    return parseSourceSpec({
      id: 'data',
      glob: join(dir, 'data', '*.ttl'),
      storage: 'disk',
    });
  }

  it('builds the Glob index under the overridden cache root', async () => {
    const override = join(dir, 'elsewhere');
    const resolved = await resolveSourceResult(diskGlob(), {
      configDir: dir,
      sparqlyVersion: 'cache-location-test',
      indexCacheDir: override,
    });
    expect(resolved.isOk()).toBe(true);
    if (!resolved.isOk()) throw new Error('unreachable');
    const sources = resolved.value;
    if (sources.mode !== 'disk-backed') throw new Error('expected disk-backed');
    try {
      // The index materialized under <override>/<id>/, clear of <configDir>.
      expect(sources.indexDir).toBe(join(override, 'data'));
      const manifest = await stat(join(override, 'data', 'manifest.json'));
      expect(manifest.isFile()).toBe(true);
      // The redirected index still answers the indexed quads.
      const engine = new QueryEngine(sources.source);
      const result = await engine.execute('SELECT ?s WHERE { ?s ?p ?o }');
      const subjects = JSON.parse(result.body).results.bindings.map(
        (b: { s: { value: string } }) => b.s.value,
      );
      expect(subjects).toEqual(['http://example.org/a']);
    } finally {
      await sources.close();
    }
  });

  it('defaults the index under <configDir>/.sparqly/index when no override is given', async () => {
    const resolved = await resolveSourceResult(diskGlob(), {
      configDir: dir,
      sparqlyVersion: 'cache-location-test',
    });
    expect(resolved.isOk()).toBe(true);
    if (!resolved.isOk()) throw new Error('unreachable');
    const sources = resolved.value;
    if (sources.mode !== 'disk-backed') throw new Error('expected disk-backed');
    try {
      // With no `indexCacheDir`, the cache root stays `<configDir>/.sparqly/index`.
      expect(sources.indexDir).toBe(join(dir, '.sparqly', 'index', 'data'));
      const manifest = await stat(
        join(dir, '.sparqly', 'index', 'data', 'manifest.json'),
      );
      expect(manifest.isFile()).toBe(true);
    } finally {
      await sources.close();
    }
  });

  it('reopens and reuses an override-located index across resolves', async () => {
    const override = join(dir, 'elsewhere');
    const opts = {
      configDir: dir,
      sparqlyVersion: 'cache-location-test',
      indexCacheDir: override,
    };

    const first = await resolveSourceResult(diskGlob(), opts);
    expect(first.isOk()).toBe(true);
    if (first.isOk() && first.value.mode === 'disk-backed') {
      await first.value.close();
    }

    // The source file changes after the index was built under the override.
    await writeFile(
      join(dir, 'data', 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:changed ex:p ex:b .',
    );

    const second = await resolveSourceResult(diskGlob(), opts);
    expect(second.isOk()).toBe(true);
    if (!second.isOk()) throw new Error('unreachable');
    const sources = second.value;
    if (sources.mode !== 'disk-backed') throw new Error('expected disk-backed');
    try {
      expect(sources.indexDir).toBe(join(override, 'data'));
      const engine = new QueryEngine(sources.source);
      const result = await engine.execute('SELECT ?s WHERE { ?s ?p ?o }');
      const subjects = JSON.parse(result.body).results.bindings.map(
        (b: { s: { value: string } }) => b.s.value,
      );
      // The second resolve reopened the index already built under
      // <override>/data — it answers the originally indexed quad, not the
      // post-build edit. A rebuild, or a look at the wrong cache root, would
      // surface `ex:changed` instead.
      expect(subjects).toEqual(['http://example.org/a']);
    } finally {
      await sources.close();
    }
  });
});
