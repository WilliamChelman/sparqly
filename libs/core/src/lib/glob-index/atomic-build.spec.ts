import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryEngine } from '../engine';
import { buildGlobIndexAtomic } from './atomic-build';
import { indexManifestPath } from './glob-index-layout';
import { openGlobIndex } from './glob-index-handle';

/**
 * Coverage for the atomic-rename Glob index build (#346): a build writes into
 * a unique temp dir and only renames it to the real index path once the
 * manifest is written, so an interrupted build never leaves a half-index at
 * the real path. Stale temp dirs from prior interrupted builds are swept.
 */
describe('buildGlobIndexAtomic', () => {
  let dir: string;
  const SPARQLY_VERSION = '9.9.9-test';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-atomic-build-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  it('builds an index at the real index path, queryable through the engine', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const indexDir = join(dir, 'index', 'data');

    const built = await buildGlobIndexAtomic({
      glob: join(dir, '*.ttl'),
      transforms: [],
      indexDir,
      sparqlyVersion: SPARQLY_VERSION,
    });

    expect(built.isOk()).toBe(true);
    expect(await exists(indexManifestPath(indexDir))).toBe(true);

    const handle = await openGlobIndex(indexDir);
    try {
      const engine = new QueryEngine(handle.source);
      const result = await engine.execute('SELECT ?s WHERE { ?s ?p ?o }');
      const subjects = JSON.parse(result.body).results.bindings.map(
        (b: { s: { value: string } }) => b.s.value,
      );
      expect(subjects).toEqual(['http://example.org/a']);
    } finally {
      await handle.close();
    }
  });

  it('leaves no half-index at the real path when the build fails', async () => {
    // A malformed RDF file makes `buildGlobIndex` throw mid-stream — standing
    // in for a build interrupted before its atomic rename.
    await writeFile(join(dir, 'broken.ttl'), 'this is not turtle <<<');
    const indexDir = join(dir, 'index', 'data');

    const built = await buildGlobIndexAtomic({
      glob: join(dir, '*.ttl'),
      transforms: [],
      indexDir,
      sparqlyVersion: SPARQLY_VERSION,
    });

    expect(built.isErr()).toBe(true);
    // The real index path was never created — no half-index landed there.
    expect(await exists(indexDir)).toBe(false);
  });

  it('leaves a prior index intact when a rebuild fails', async () => {
    const source = join(dir, 'a.ttl');
    await writeFile(
      source,
      '@prefix ex: <http://example.org/> . ex:original ex:p ex:b .',
    );
    const indexDir = join(dir, 'index', 'data');
    const options = {
      glob: join(dir, '*.ttl'),
      transforms: [],
      indexDir,
      sparqlyVersion: SPARQLY_VERSION,
    };

    const first = await buildGlobIndexAtomic(options);
    expect(first.isOk()).toBe(true);

    // The source goes malformed — the rebuild now fails.
    await writeFile(source, 'this is not turtle <<<');
    const second = await buildGlobIndexAtomic(options);
    expect(second.isErr()).toBe(true);

    // The originally built index is still in place and still answers.
    const handle = await openGlobIndex(indexDir);
    try {
      const engine = new QueryEngine(handle.source);
      const result = await engine.execute('SELECT ?s WHERE { ?s ?p ?o }');
      const subjects = JSON.parse(result.body).results.bindings.map(
        (b: { s: { value: string } }) => b.s.value,
      );
      expect(subjects).toEqual(['http://example.org/original']);
    } finally {
      await handle.close();
    }
  });

  it('preserves nested child index dirs when the meta index is rebuilt', async () => {
    // A `storage: disk` + `splitByFile: true` glob lays each child index
    // nested inside the meta index dir (`<meta>/<file>/`). Rebuilding the
    // meta must not delete those already-built child indexes.
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const indexDir = join(dir, 'index', 'data');
    const options = {
      glob: join(dir, '*.ttl'),
      transforms: [],
      indexDir,
      sparqlyVersion: SPARQLY_VERSION,
    };

    const first = await buildGlobIndexAtomic(options);
    expect(first.isOk()).toBe(true);

    // A pre-built child index sits nested inside the meta index dir.
    const childDir = join(indexDir, 'a.ttl');
    await mkdir(childDir, { recursive: true });
    await writeFile(join(childDir, 'manifest.json'), '{"child":true}');

    // Rebuild the meta index — the nested child must survive.
    const second = await buildGlobIndexAtomic(options);
    expect(second.isOk()).toBe(true);
    expect(await exists(join(childDir, 'manifest.json'))).toBe(true);
  });

  it('sweeps a stale temp dir left by a prior interrupted build', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const indexDir = join(dir, 'index', 'data');

    // A leftover temp dir from a build that was killed before its rename.
    // Pid 0x7fffffff is above any plausible kernel pid_max — guaranteed dead.
    const staleTempDir = join(
      dirname(indexDir),
      `${basename(indexDir)}.building-2147483647-deadbeef`,
    );
    await mkdir(staleTempDir, { recursive: true });
    await writeFile(join(staleTempDir, 'partial'), 'half-written index');

    const built = await buildGlobIndexAtomic({
      glob: join(dir, '*.ttl'),
      transforms: [],
      indexDir,
      sparqlyVersion: SPARQLY_VERSION,
    });
    expect(built.isOk()).toBe(true);

    // The stale temp dir was swept; only the real index dir remains.
    expect(await exists(staleTempDir)).toBe(false);
    const siblings = await readdir(dirname(indexDir));
    expect(siblings).toEqual(['data']);
  });

  it('preserves a sibling temp dir whose pid is still alive (concurrent build)', async () => {
    // A sibling `<base>.building-<pid>-*` belongs to another in-flight build of
    // the same source (e.g. IndexBuildPool spawned one while a manual
    // `sparqly index` runs). Sweeping it mid-ingest would crash that build
    // with ENOENT. The test process's own pid stands in for the live owner.
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const indexDir = join(dir, 'index', 'data');
    const liveTempDir = join(
      dirname(indexDir),
      `${basename(indexDir)}.building-${process.pid}-cafebabe`,
    );
    await mkdir(liveTempDir, { recursive: true });
    await writeFile(join(liveTempDir, 'partial'), 'still-being-written');

    const built = await buildGlobIndexAtomic({
      glob: join(dir, '*.ttl'),
      transforms: [],
      indexDir,
      sparqlyVersion: SPARQLY_VERSION,
    });
    expect(built.isOk()).toBe(true);

    // The live-pid temp dir survived the sweep; the concurrent build's
    // in-flight files are untouched.
    expect(await exists(liveTempDir)).toBe(true);
    expect(await exists(join(liveTempDir, 'partial'))).toBe(true);
  });
});
