import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SparqlyLogFields, SparqlyLogger } from 'common';
import {
  defaultGlobWalker,
  diskBackedIndexIdentity,
  ensureGlobIndex,
  expandSplitGlobs,
  globIndexDir,
  parseSourceSpecs,
  type ParsedFileSource,
  type ParsedGlobSource,
  type ParsedSource,
} from 'core';
import { EngineMap } from './engine-map';
import type { BuildChild, SpawnIndexBuild } from './index-build-pool';
import { SourceStateEmitter } from '../sources/source-state-emitter';
import type { SourceTransition } from '../sources/source-state-event';

interface RecordedLog {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  fields?: SparqlyLogFields;
}

function recordingLogger(): { logger: SparqlyLogger; entries: RecordedLog[] } {
  const entries: RecordedLog[] = [];
  const record =
    (level: RecordedLog['level']) =>
    (msg: string, fields?: SparqlyLogFields): void => {
      entries.push({ level, msg, fields });
    };
  return {
    entries,
    logger: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    },
  };
}

describe('EngineMap', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-engine-map-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('create() returns immediately without resolving materialized sources (no boot-time source-loaded log) — ADR-0031', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const registry = parseSourceSpecs([
      { id: 'files', glob: join(dir, '*.ttl') },
    ]);
    const rec = recordingLogger();

    const map = await EngineMap.create(registry, { logger: rec.logger });
    try {
      const loadedAtBoot = rec.entries.filter(
        (e) => e.msg === 'source-loaded',
      );
      expect(loadedAtBoot).toHaveLength(0);
      expect(map.allIds()).toEqual(['files']);
      // Until first ensure(), there is no Store and no opened files.
      expect(map.getStoreRef('files')).toBeUndefined();
      expect(map.getFiles('files')).toEqual([]);
    } finally {
      await map.close();
    }
  });

  it('ensure(id) lazily resolves a materialized source on first call, then memoizes the engine and store', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const registry = parseSourceSpecs([
      { id: 'files', glob: join(dir, '*.ttl') },
    ]);
    const rec = recordingLogger();

    const map = await EngineMap.create(registry, { logger: rec.logger });
    try {
      const engine = (await map.ensure('files'))._unsafeUnwrap();
      const result = await engine.execute(
        'SELECT ?s WHERE { ?s ?p ?o }',
        { format: 'json' },
      );
      const json = JSON.parse(result.body) as {
        results: { bindings: Array<{ s: { value: string } }> };
      };
      expect(json.results.bindings.map((b) => b.s.value)).toEqual([
        'http://example.org/a',
      ]);

      // Second ensure() reuses the same engine and does not re-load.
      const again = (await map.ensure('files'))._unsafeUnwrap();
      expect(again).toBe(engine);

      const loaded = rec.entries.filter((e) => e.msg === 'source-loaded');
      expect(loaded).toHaveLength(1);
      expect(loaded[0].fields).toMatchObject({
        source: 'files',
        kind: 'glob',
        files: 1,
        quads: 1,
      });
      expect(map.getStoreRef('files')).toBeDefined();
      expect(map.getFiles('files')).toEqual([join(dir, 'data.ttl')]);
    } finally {
      await map.close();
    }
  });

  it('two concurrent first-touch ensure() calls share one in-flight load (resolveSourceResult runs exactly once)', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const registry = parseSourceSpecs([
      { id: 'files', glob: join(dir, '*.ttl') },
    ]);
    const rec = recordingLogger();

    const map = await EngineMap.create(registry, { logger: rec.logger });
    try {
      const [a, b] = await Promise.all([
        map.ensure('files'),
        map.ensure('files'),
      ]);
      expect(a._unsafeUnwrap()).toBe(b._unsafeUnwrap());
      const loaded = rec.entries.filter((e) => e.msg === 'source-loaded');
      expect(loaded).toHaveLength(1);
    } finally {
      await map.close();
    }
  });

  it('endpoint pass-through entries are built synchronously at construction; ensure() resolves with the pre-built engine', async () => {
    const registry = parseSourceSpecs([
      { id: 'remote', endpoint: 'http://127.0.0.1:1/sparql' },
    ]);
    const rec = recordingLogger();

    const map = await EngineMap.create(registry, { logger: rec.logger });
    try {
      expect(map.allIds()).toEqual(['remote']);
      // No load was needed; ensure() still resolves and returns the engine.
      const engine = (await map.ensure('remote'))._unsafeUnwrap();
      expect(engine).toBeDefined();
      expect(map.getStoreRef('remote')).toBeUndefined();
    } finally {
      await map.close();
    }
  });

  it('threads a SparqlyLogger into each engine so SPARQL executions emit the `query` debug event with the source @id and resolution mode', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const registry = parseSourceSpecs([
      { id: 'files', glob: join(dir, '*.ttl') },
    ]);
    const rec = recordingLogger();

    const map = await EngineMap.create(registry, { logger: rec.logger });
    try {
      const engine = (await map.ensure('files'))._unsafeUnwrap();
      await engine.execute('SELECT ?s WHERE { ?s ?p ?o }', {
        format: 'json',
      });
    } finally {
      await map.close();
    }

    const queryEvents = rec.entries.filter(
      (e) => e.level === 'debug' && e.msg === 'query',
    );
    expect(queryEvents).toHaveLength(1);
    expect(queryEvents[0].fields).toMatchObject({
      source: 'files',
      mode: 'materialized',
      type: 'SELECT',
    });
    expect(typeof queryEvents[0].fields?.['ms']).toBe('number');
  });

  it('close() releases entries and is idempotent', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const registry = parseSourceSpecs([
      { id: 'files', glob: join(dir, '*.ttl') },
    ]);

    const map = await EngineMap.create(registry);
    expect(map.allIds()).toEqual(['files']);

    await map.close();
    expect(map.allIds()).toEqual([]);
    // Second close() must not throw.
    await map.close();
  });

  it('allIds excludes reference entries from the registry', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const registry: ParsedSource[] = [
      ...parseSourceSpecs([{ id: 'real', glob: join(dir, '*.ttl') }]),
      { kind: 'reference', ref: 'real' },
    ];

    const map = await EngineMap.create(registry);
    try {
      expect(map.allIds()).toEqual(['real']);
    } finally {
      await map.close();
    }
  });

  it('ensure() resolves with an empty-store engine when a materialized source matches no files (ADR-0028)', async () => {
    const registry = parseSourceSpecs([
      { id: 'missing', glob: join(dir, '*.does-not-exist') },
    ]);

    const map = await EngineMap.create(registry);
    try {
      expect(map.allIds()).toEqual(['missing']);
      const engine = (await map.ensure('missing'))._unsafeUnwrap();
      expect(engine).toBeDefined();
    } finally {
      await map.close();
    }
  });

  it('pass-through endpoint sources do not block boot when the remote is unreachable', async () => {
    const registry = parseSourceSpecs([
      { id: 'remote', endpoint: 'http://127.0.0.1:1/sparql' },
    ]);

    const map = await EngineMap.create(registry);
    try {
      expect(map.allIds()).toEqual(['remote']);
      // Pass-through has no local store.
      expect(map.getStoreRef('remote')).toBeUndefined();
    } finally {
      await map.close();
    }
  });

  it('two concurrent first-touch ensure() calls during a failing load share one in-flight rejection (resolveSourceResult runs exactly once per attempt) — #290', async () => {
    await writeFile(join(dir, 'broken.ttl'), 'this is not valid turtle .');
    const registry = parseSourceSpecs([
      { id: 'files', glob: join(dir, '*.ttl') },
    ]);

    const map = await EngineMap.create(registry);
    try {
      const [a, b] = await Promise.all([
        map.ensure('files'),
        map.ensure('files'),
      ]);
      expect(a.isErr()).toBe(true);
      expect(b.isErr()).toBe(true);
      // Same in-flight load → both waiters observe the very same error
      // payload by identity, not two independent loads producing two
      // distinct error objects.
      if (a.isErr() && b.isErr()) {
        expect(a.error).toBe(b.error);
        expect(a.error.kind).toBe('glob-load');
      }
    } finally {
      await map.close();
    }
  });

  it('ensure() returns Err with a typed SourceError when the underlying load fails (ADR-0024)', async () => {
    await writeFile(join(dir, 'broken.ttl'), 'this is not valid turtle .');
    const registry = parseSourceSpecs([
      { id: 'files', glob: join(dir, '*.ttl') },
    ]);

    const map = await EngineMap.create(registry);
    try {
      const result = await map.ensure('files');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe('glob-load');
      }
    } finally {
      await map.close();
    }
  });

  it('a failing ensure() clears its memoized load so a follow-up call retries fresh — fix-the-file → next request succeeds, no restart (#290)', async () => {
    const ttl = join(dir, 'data.ttl');
    await writeFile(ttl, 'this is not valid turtle .');
    const registry = parseSourceSpecs([
      { id: 'files', glob: join(dir, '*.ttl') },
    ]);

    const map = await EngineMap.create(registry);
    try {
      const first = await map.ensure('files');
      expect(first.isErr()).toBe(true);
      if (first.isErr()) expect(first.error.kind).toBe('glob-load');

      // Self-heal: fix the file in place; no map rebuild, no server restart.
      await writeFile(
        ttl,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
      );

      const second = await map.ensure('files');
      expect(second.isOk()).toBe(true);
      const engine = second._unsafeUnwrap();
      const exec = await engine.execute('SELECT ?s WHERE { ?s ?p ?o }', {
        format: 'json',
      });
      const json = JSON.parse(exec.body) as {
        results: { bindings: Array<{ s: { value: string } }> };
      };
      expect(json.results.bindings.map((b) => b.s.value)).toEqual([
        'http://example.org/a',
      ]);
    } finally {
      await map.close();
    }
  });

  describe('disk-backed glob (storage: disk) — child-process index build, ADR-0041 / -0042', () => {
    const SAMPLE = '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .';
    const SELECT = 'SELECT ?s WHERE { ?s ?p ?o }';

    function subjects(body: string): string[] {
      const json = JSON.parse(body) as {
        results: { bindings: Array<{ s: { value: string } }> };
      };
      return json.results.bindings.map((b) => b.s.value);
    }

    /**
     * A {@link BuildChild} whose `exit` fires once an in-process Glob index
     * build settles — the unit-test stand-in for a real `sparqly index @id`
     * subprocess.
     */
    class StubBuildChild implements BuildChild {
      private readonly exitListeners: Array<(code: number | null) => void> =
        [];

      on(event: 'exit', listener: (code: number | null) => void): void {
        if (event === 'exit') this.exitListeners.push(listener);
      }

      kill(): void {
        // The in-process build cannot be signalled; tests drain via whenIdle().
      }

      settle(code: number): void {
        for (const listener of this.exitListeners) listener(code);
      }
    }

    /**
     * An injectable {@link SpawnIndexBuild} standing in for the real `sparqly
     * index @id` child: it runs the actual Glob index build for the requested
     * registry source in-process, then fires the child's `exit` — exercising
     * EngineMap's spawn → build → `ready` path without a real subprocess. The
     * returned `spawned` array records every requested `@id`.
     */
    function inProcessIndexBuilds(
      registry: ReadonlyArray<ParsedSource>,
      configDir: string,
      indexCacheDir?: string,
    ): { spawn: SpawnIndexBuild; spawned: string[] } {
      const spawned: string[] = [];
      const byId = new Map<string, ParsedGlobSource | ParsedFileSource>();
      for (const src of registry) {
        if (
          (src.kind === 'glob' || src.kind === 'file') &&
          src.id !== undefined
        ) {
          byId.set(src.id, src);
        }
      }
      const spawn: SpawnIndexBuild = (id) => {
        spawned.push(id);
        const child = new StubBuildChild();
        const source = byId.get(id);
        if (source === undefined) {
          queueMicrotask(() => child.settle(1));
          return child;
        }
        const { indexId, pattern } = diskBackedIndexIdentity(source);
        const indexDir = globIndexDir(configDir, indexId, indexCacheDir);
        void ensureGlobIndex({
          glob: pattern,
          transforms: source.transforms ?? [],
          indexDir,
          sparqlyVersion: 'test',
        }).then((outcome) => child.settle(outcome.isOk() ? 0 : 1));
        return child;
      };
      return { spawn, spawned };
    }

    it('first touch of a disk-backed glob with no built index reports `indexing` and spawns a build child instead of blocking', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      const builds = inProcessIndexBuilds(registry, dir);

      const map = await EngineMap.create(registry, {
        configDir: dir,
        spawnIndexBuild: builds.spawn,
      });
      try {
        // First touch reports `indexing` at once — the build runs in an
        // isolated child, not inline on `serve`'s event loop.
        const result = await map.ensure('big');
        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error.kind).toBe('indexing');
        expect(builds.spawned).toEqual(['big']);
      } finally {
        await map.whenIdle();
        await map.close();
      }
    });

    it('once the spawned build child completes, ensure() returns a ready engine that answers SPARQL against the disk-backed index', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      const builds = inProcessIndexBuilds(registry, dir);

      const map = await EngineMap.create(registry, {
        configDir: dir,
        spawnIndexBuild: builds.spawn,
      });
      try {
        const first = await map.ensure('big');
        expect(first.isErr()).toBe(true);

        await map.whenIdle();

        const second = await map.ensure('big');
        expect(second.isOk()).toBe(true);
        const engine = second._unsafeUnwrap();
        const exec = await engine.execute(SELECT, { format: 'json' });
        expect(subjects(exec.body)).toEqual(['http://example.org/a']);
      } finally {
        await map.whenIdle();
        await map.close();
      }
    });

    it('an already-built index opens straight to `ready` on first touch — no build child spawned', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);

      // First server lifetime: builds the index, then releases its lock.
      const firstBuilds = inProcessIndexBuilds(registry, dir);
      const builder = await EngineMap.create(registry, {
        configDir: dir,
        spawnIndexBuild: firstBuilds.spawn,
      });
      await builder.ensure('big');
      await builder.whenIdle();
      await builder.close();

      // Second server lifetime over the same configDir: the index is present,
      // so the very first touch resolves `ready` with no child spawned.
      const builds = inProcessIndexBuilds(registry, dir);
      const map = await EngineMap.create(registry, {
        configDir: dir,
        spawnIndexBuild: builds.spawn,
      });
      try {
        const result = await map.ensure('big');
        expect(result.isOk()).toBe(true);
        const exec = await result
          ._unsafeUnwrap()
          .execute(SELECT, { format: 'json' });
        expect(subjects(exec.body)).toEqual(['http://example.org/a']);
        expect(builds.spawned).toEqual([]);
      } finally {
        await map.whenIdle();
        await map.close();
      }
    });

    it('a build child that exits non-zero sticks the disk-backed entry in failed — the next ensure() does NOT re-spawn; the operator must Retry to recover (#360, parent #352)', async () => {
      const ttl = join(dir, 'data.ttl');
      await writeFile(ttl, 'this is not valid turtle .');
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      const builds = inProcessIndexBuilds(registry, dir);

      const map = await EngineMap.create(registry, {
        configDir: dir,
        spawnIndexBuild: builds.spawn,
      });
      try {
        const first = await map.ensure('big');
        expect(first.isErr()).toBe(true);
        await map.whenIdle(); // the build child exits non-zero on the bad file

        // Self-heal: fix the file. Under the sticky-failed contract (#360),
        // the next query touch must NOT silently re-spawn — only an
        // operator-initiated `requestBuild` (Retry) clears the sticky and
        // spawns the rebuild that observes the fixed file.
        await writeFile(ttl, SAMPLE);
        const stuck = await map.ensure('big');
        expect(stuck.isErr()).toBe(true);
        expect(builds.spawned).toEqual(['big']); // still just the one spawn

        // Retry path: clears the sticky and spawns a fresh child.
        const outcome = map.requestBuild('big');
        expect(outcome).toBe('requested');
        await map.whenIdle();
        const ready = await map.ensure('big');
        expect(ready.isOk()).toBe(true);
        const exec = await ready
          ._unsafeUnwrap()
          .execute(SELECT, { format: 'json' });
        expect(subjects(exec.body)).toEqual(['http://example.org/a']);
        expect(builds.spawned).toEqual(['big', 'big']);
      } finally {
        await map.whenIdle();
        await map.close();
      }
    });

    it('repeated touches of a permanently failing disk-backed source spawn exactly one build — sticky-failed never silently respawns (#360)', async () => {
      // A malformed RDF file: every build child exits non-zero. Under the
      // sticky-failed contract (#360) the FIRST touch spawns, the build
      // fails, and every subsequent ensure() observes the sticky lastError
      // and returns the same `indexing` retry-error without touching the
      // pool — no more process-spawn storms, no more per-cooldown reruns,
      // until the operator clicks Retry on the Sources page.
      await writeFile(join(dir, 'data.ttl'), 'this is not valid turtle .');
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      const builds = inProcessIndexBuilds(registry, dir);

      const map = await EngineMap.create(registry, {
        configDir: dir,
        spawnIndexBuild: builds.spawn,
      });
      try {
        const first = await map.ensure('big');
        expect(first.isErr()).toBe(true);
        await map.whenIdle();

        // 25 HTTP touches while the source remains broken — must spawn
        // exactly zero further children.
        for (let i = 0; i < 25; i++) {
          const r = await map.ensure('big');
          expect(r.isErr()).toBe(true);
        }
        expect(builds.spawned).toEqual(['big']);
        // Now Retry — the sticky clears and a fresh build spawns.
        const outcome = map.requestBuild('big');
        expect(outcome).toBe('requested');
        expect(builds.spawned).toEqual(['big', 'big']);
      } finally {
        await map.whenIdle();
        await map.close();
      }
    });

    it('two concurrent first-touch ensure() calls share one build child — request is idempotent', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      const builds = inProcessIndexBuilds(registry, dir);

      const map = await EngineMap.create(registry, {
        configDir: dir,
        spawnIndexBuild: builds.spawn,
      });
      try {
        const [a, b] = await Promise.all([
          map.ensure('big'),
          map.ensure('big'),
        ]);
        expect(a.isErr()).toBe(true);
        expect(b.isErr()).toBe(true);
        await map.whenIdle();
        expect(builds.spawned).toEqual(['big']);
      } finally {
        await map.whenIdle();
        await map.close();
      }
    });

    it('a disk-backed split-glob File child runs its own child-process index build — first touch reports `indexing`, then opens `ready`', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const parsed = parseSourceSpecs([
        {
          id: 'docs',
          glob: join(dir, '*.ttl'),
          splitByFile: true,
          storage: 'disk',
        },
      ]);
      const registry = await expandSplitGlobs(parsed, {
        walkGlob: defaultGlobWalker,
      });
      const builds = inProcessIndexBuilds(registry, dir);

      const map = await EngineMap.create(registry, {
        configDir: dir,
        spawnIndexBuild: builds.spawn,
      });
      try {
        // The child inherited `storage: disk` — its first touch must spawn a
        // build child and report `indexing`, not block on the build.
        const first = await map.ensure('docs/data.ttl');
        expect(first.isErr()).toBe(true);
        if (first.isErr()) expect(first.error.kind).toBe('indexing');
        expect(builds.spawned).toEqual(['docs/data.ttl']);

        await map.whenIdle();
        const ready = await map.ensure('docs/data.ttl');
        expect(ready.isOk()).toBe(true);
        const exec = await ready
          ._unsafeUnwrap()
          .execute(SELECT, { format: 'json' });
        expect(subjects(exec.body)).toEqual(['http://example.org/a']);
      } finally {
        await map.whenIdle();
        await map.close();
      }
    });

    it('builds and reuses a disk-backed index under an `indexCacheDir` override — no rebuild on the second lifetime', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      const override = join(dir, 'index-volume');

      // First server lifetime: builds the index under the override root.
      const firstBuilds = inProcessIndexBuilds(registry, dir, override);
      const builder = await EngineMap.create(registry, {
        configDir: dir,
        indexCacheDir: override,
        spawnIndexBuild: firstBuilds.spawn,
      });
      await builder.ensure('big');
      await builder.whenIdle();
      await builder.close();

      // The index materialized under <override>/big/, not <configDir>/.sparqly.
      expect((await stat(join(override, 'big', 'manifest.json'))).isFile()).toBe(
        true,
      );

      // Second lifetime over the same override: the first touch must find the
      // already-built index under <override>/big/ and open straight to `ready`.
      const builds = inProcessIndexBuilds(registry, dir, override);
      const map = await EngineMap.create(registry, {
        configDir: dir,
        indexCacheDir: override,
        spawnIndexBuild: builds.spawn,
      });
      try {
        const result = await map.ensure('big');
        expect(result.isOk()).toBe(true);
        const exec = await result
          ._unsafeUnwrap()
          .execute(SELECT, { format: 'json' });
        expect(subjects(exec.body)).toEqual(['http://example.org/a']);
        // No build child — the override-located index was found and reused; a
        // manifest check at the wrong root would force a rebuild.
        expect(builds.spawned).toEqual([]);
      } finally {
        await map.whenIdle();
        await map.close();
      }
    });

    it('readState reports `failed` with the pool-captured error after a non-zero build exit (#360, parent #352)', async () => {
      // A bad input file → the build child exits non-zero → the pool's
      // failure info lands on entry.lastError → readState surfaces `failed`
      // with the inline `error` block ready for the Sources page row.
      await writeFile(join(dir, 'data.ttl'), 'this is not valid turtle .');
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      const builds = inProcessIndexBuilds(registry, dir);
      const map = await EngineMap.create(registry, {
        configDir: dir,
        spawnIndexBuild: builds.spawn,
      });
      try {
        const first = await map.ensure('big');
        expect(first.isErr()).toBe(true);
        await map.whenIdle();

        const state = await map.readState('big');
        expect(state.mode).toBe('disk-backed');
        if (state.mode !== 'disk-backed') throw new Error('narrow');
        expect(state.state).toBe('failed');
        expect(state.error?.kind).toBe('index-build-failed');
        // The pool's `inProcessIndexBuilds` settles with code 1; no real
        // stderr stream is wired in the stub, so `details` is absent — the
        // real `sparqly index` child piping its stderr through the pool
        // populates it in production.
        expect(state.error?.message).toMatch(/exit code/);
      } finally {
        await map.whenIdle();
        await map.close();
      }
    });

    it('Retry (requestBuild) clears the sticky failure and a successful subsequent build returns the entry to ready (#360)', async () => {
      const ttl = join(dir, 'data.ttl');
      await writeFile(ttl, 'this is not valid turtle .');
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      const builds = inProcessIndexBuilds(registry, dir);
      const map = await EngineMap.create(registry, {
        configDir: dir,
        spawnIndexBuild: builds.spawn,
      });
      try {
        const first = await map.ensure('big');
        expect(first.isErr()).toBe(true);
        await map.whenIdle();

        // Fix the file before Retry — the operator's flow on the page.
        await writeFile(ttl, SAMPLE);
        map.requestBuild('big');
        await map.whenIdle();

        const state = await map.readState('big');
        expect(state.mode).toBe('disk-backed');
        if (state.mode !== 'disk-backed') throw new Error('narrow');
        expect(state.state).toBe('ready');
        expect(state.error).toBeUndefined();
      } finally {
        await map.whenIdle();
        await map.close();
      }
    });
  });

  describe('readState(id) — Sources page snapshot (#353)', () => {
    const SAMPLE = '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .';

    it('returns not-loaded for an untouched in-memory glob (no lazy materialization triggered)', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'files', glob: join(dir, '*.ttl') },
      ]);
      const rec = recordingLogger();
      const map = await EngineMap.create(registry, { logger: rec.logger });
      try {
        const state = await map.readState('files');
        expect(state).toEqual({ mode: 'in-memory', state: 'not-loaded' });
        // Reading state must never trigger a load (ADR-0031 contract): no
        // source-loaded log was emitted, and the store ref is still empty.
        expect(
          rec.entries.filter((e) => e.msg === 'source-loaded'),
        ).toHaveLength(0);
        expect(map.getStoreRef('files')).toBeUndefined();
      } finally {
        await map.close();
      }
    });

    it('returns loaded for an in-memory source after a successful ensure() — Sources page reflects the live current state', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'files', glob: join(dir, '*.ttl') },
      ]);
      const map = await EngineMap.create(registry);
      try {
        (await map.ensure('files'))._unsafeUnwrap();
        const state = await map.readState('files');
        // Layer 2 metrics (#355) ride alongside the state — the dedicated
        // metrics test below asserts their shape; here we just check the
        // state-machine projection itself.
        expect(state.mode).toBe('in-memory');
        if (state.mode === 'in-memory') expect(state.state).toBe('loaded');
      } finally {
        await map.close();
      }
    });

    /*
     * #360: a failing in-memory load surfaces on the Sources page as a
     * `failed` row with the inline `error` block — preserving ADR-0031's
     * self-heal contract (the load slot still clears so the next `ensure()`
     * retries the underlying file/ref). The `lastError` lives on the entry
     * until the next load-start clears it; until then `readState` projects
     * `failed` with `{ kind, message }` ready for the projector to ship.
     */
    it('returns failed with an error block after an in-memory load fails (#360)', async () => {
      await writeFile(join(dir, 'broken.ttl'), 'this is not valid turtle .');
      const registry = parseSourceSpecs([
        { id: 'files', glob: join(dir, '*.ttl') },
      ]);
      const map = await EngineMap.create(registry);
      try {
        const result = await map.ensure('files');
        expect(result.isErr()).toBe(true);
        const state = await map.readState('files');
        expect(state.mode).toBe('in-memory');
        if (state.mode !== 'in-memory') throw new Error('narrow');
        expect(state.state).toBe('failed');
        expect(state.error?.kind).toBe('glob-load');
        // The message is the formatted `SourceError` body — covers the file
        // path so the operator can diagnose without opening logs.
        expect(state.error?.message).toContain('broken.ttl');
      } finally {
        await map.close();
      }
    });

    it('clears the failed error on the next successful ensure() — ADR-0031 self-heal (#360)', async () => {
      const ttl = join(dir, 'data.ttl');
      await writeFile(ttl, 'this is not valid turtle .');
      const registry = parseSourceSpecs([
        { id: 'files', glob: join(dir, '*.ttl') },
      ]);
      const map = await EngineMap.create(registry);
      try {
        (await map.ensure('files'))._unsafeUnwrap = (): never => {
          throw new Error('expected err');
        };
        await map.ensure('files');
        const failed = await map.readState('files');
        if (failed.mode !== 'in-memory') throw new Error('narrow');
        expect(failed.state).toBe('failed');

        // Fix the file, retry — the next ensure() drives the load and the
        // error clears (a successful load supersedes the prior failure).
        await writeFile(
          ttl,
          '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
        );
        (await map.ensure('files'))._unsafeUnwrap();
        const healed = await map.readState('files');
        if (healed.mode !== 'in-memory') throw new Error('narrow');
        expect(healed.state).toBe('loaded');
        expect(healed.error).toBeUndefined();
      } finally {
        await map.close();
      }
    });

    it('returns loading while an in-flight first-touch load has not yet settled', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'files', glob: join(dir, '*.ttl') },
      ]);
      const map = await EngineMap.create(registry);
      try {
        // Kick the load but do not await it — readState should observe the
        // in-flight Promise and report `loading` without forcing settle.
        const inFlight = map.ensure('files');
        const state = await map.readState('files');
        expect(state).toEqual({ mode: 'in-memory', state: 'loading' });
        // Drain so close() does not race the still-resolving Store handle.
        (await inFlight)._unsafeUnwrap();
      } finally {
        await map.close();
      }
    });

    it('returns Layer 2 metrics (quads, files, loadedAt, loadMs) on a loaded in-memory source — #355', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'files', glob: join(dir, '*.ttl') },
      ]);
      const before = Date.now();
      const map = await EngineMap.create(registry);
      try {
        (await map.ensure('files'))._unsafeUnwrap();
        const after = Date.now();
        const state = await map.readState('files');
        expect(state.mode).toBe('in-memory');
        if (state.mode !== 'in-memory') throw new Error('narrow');
        expect(state.state).toBe('loaded');
        // The metrics block is populated on every successful load — the
        // Sources page projects Layer 2 onto the row from these fields.
        expect(state.metrics?.quads).toBe(1);
        expect(state.metrics?.files).toBe(1);
        // `loadedAt` is an epoch-ms stamp around the resolveSourceResult call.
        expect(state.metrics?.loadedAt).toBeGreaterThanOrEqual(before);
        expect(state.metrics?.loadedAt).toBeLessThanOrEqual(after + 1);
        // `loadMs` is wall-clock; it can be 0 on a fast machine but never < 0.
        expect(state.metrics?.loadMs).toBeGreaterThanOrEqual(0);
      } finally {
        await map.close();
      }
    });

    it('omits metrics on an untouched (not-loaded) in-memory source — #355', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'files', glob: join(dir, '*.ttl') },
      ]);
      const map = await EngineMap.create(registry);
      try {
        const state = await map.readState('files');
        expect(state).toEqual({ mode: 'in-memory', state: 'not-loaded' });
      } finally {
        await map.close();
      }
    });

    it('returns mode endpoint (no state field) for a pass-through endpoint source', async () => {
      const registry = parseSourceSpecs([
        { id: 'remote', endpoint: 'https://example.org/sparql' },
      ]);
      const map = await EngineMap.create(registry);
      try {
        const state = await map.readState('remote');
        expect(state).toEqual({ mode: 'endpoint' });
      } finally {
        await map.close();
      }
    });

    it('returns not-built for a disk-backed glob whose Glob index manifest is absent', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      const map = await EngineMap.create(registry, { configDir: dir });
      try {
        const state = await map.readState('big');
        // `not-built` has no manifest yet, so manifestSparqlyVersion /
        // indexBytes are unknown; `indexDir` is layout-derivable and always
        // present so the page can show the user where the index *will* land.
        expect(state).toMatchObject({ mode: 'disk-backed', state: 'not-built' });
        if (state.mode !== 'disk-backed') throw new Error('narrow');
        expect(state.disk?.indexDir).toBe(globIndexDir(dir, 'big'));
        expect(state.disk?.indexBytes).toBeUndefined();
        expect(state.disk?.manifestSparqlyVersion).toBeUndefined();
        expect(state.disk?.staleReason).toBeUndefined();
      } finally {
        await map.close();
      }
    });

    it('returns ready for a disk-backed glob whose manifest is already on disk (no open required)', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      // Build the index once in a throwaway lifetime so the manifest exists.
      const firstBuilds = (() => {
        const spawned: string[] = [];
        const spawn: SpawnIndexBuild = (id) => {
          spawned.push(id);
          const child = {
            listeners: [] as Array<(code: number | null) => void>,
            on(event: 'exit', listener: (code: number | null) => void) {
              if (event === 'exit') this.listeners.push(listener);
            },
            kill() {
              /* no-op */
            },
          };
          const source = registry.find(
            (s): s is ParsedGlobSource | ParsedFileSource =>
              (s.kind === 'glob' || s.kind === 'file') && s.id === id,
          );
          if (source === undefined) {
            queueMicrotask(() => child.listeners.forEach((l) => l(1)));
            return child;
          }
          const { indexId, pattern } = diskBackedIndexIdentity(source);
          const indexDir = globIndexDir(dir, indexId);
          void ensureGlobIndex({
            glob: pattern,
            transforms: source.transforms ?? [],
            indexDir,
            sparqlyVersion: 'test',
          }).then((outcome) =>
            child.listeners.forEach((l) => l(outcome.isOk() ? 0 : 1)),
          );
          return child;
        };
        return { spawn, spawned };
      })();
      const builder = await EngineMap.create(registry, {
        configDir: dir,
        spawnIndexBuild: firstBuilds.spawn,
      });
      await builder.ensure('big');
      await builder.whenIdle();
      await builder.close();

      const map = await EngineMap.create(registry, { configDir: dir });
      try {
        const state = await map.readState('big');
        expect(state).toMatchObject({ mode: 'disk-backed', state: 'ready' });
      } finally {
        await map.close();
      }
    });

    /*
     * #357: a `ready` disk-backed entry's readState carries Layer 3 extras so
     * the **Sources page** can show where the index lives, how big it is, what
     * sparqly built it, and how many quads it holds — without opening the
     * index (the snapshot endpoint must never grab a LevelDB lock).
     */
    it('returns Layer 3 extras (indexDir, indexBytes, manifestSparqlyVersion) and quads for a built disk-backed glob (#357)', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      const source = registry[0] as ParsedGlobSource;
      const { indexId, pattern } = diskBackedIndexIdentity(source);
      const indexDir = globIndexDir(dir, indexId);
      await ensureGlobIndex({
        glob: pattern,
        transforms: [],
        indexDir,
        sparqlyVersion: '0.29.0',
      });

      const map = await EngineMap.create(registry, { configDir: dir });
      try {
        const state = await map.readState('big');
        expect(state.mode).toBe('disk-backed');
        if (state.mode !== 'disk-backed') throw new Error('narrow');
        expect(state.state).toBe('ready');
        expect(state.disk?.indexDir).toBe(indexDir);
        expect(state.disk?.indexBytes).toBeGreaterThan(0);
        expect(state.disk?.manifestSparqlyVersion).toBe('0.29.0');
        expect(state.disk?.staleReason).toBeUndefined();
        // `quads` from the manifest's quadCount (#357) — the page surfaces it
        // without running a COUNT(*).
        expect(state.metrics?.quads).toBeGreaterThan(0);
      } finally {
        await map.close();
      }
    });

    /*
     * #357: when the matched file set drifts away from the built manifest's
     * fingerprint, readState reports `stale` with a human-readable reason
     * sourced from `compareGlobIndexManifests`. The state never silently
     * clears — only an explicit rebuild (later slice) does.
     */
    it('a query touch (ensure → entry.current set) does not mask subsequent staleness — readState still reports stale once files drift (#357, ADR-0043 no-silent-rebuild)', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      const source = registry[0] as ParsedGlobSource;
      const { indexId, pattern } = diskBackedIndexIdentity(source);
      const indexDir = globIndexDir(dir, indexId);
      await ensureGlobIndex({
        glob: pattern,
        transforms: [],
        indexDir,
        sparqlyVersion: '0.29.0',
      });

      const map = await EngineMap.create(registry, { configDir: dir });
      try {
        // A query touch opens the index; readState now sees `entry.current`.
        (await map.ensure('big'))._unsafeUnwrap();
        const fresh = await map.readState('big');
        expect(fresh.mode).toBe('disk-backed');
        if (fresh.mode !== 'disk-backed') throw new Error('narrow');
        expect(fresh.state).toBe('ready');

        // Drift the file set after the open: the open path's stale check is
        // *not* the authoritative signal for the page (the user has not
        // rebuilt). readState must re-detect drift and report `stale` —
        // ignoring `entry.current` is the only way sparqly stays true to
        // "no silent rebuild" (ADR-0043).
        await writeFile(
          join(dir, 'newcomer.ttl'),
          '@prefix ex: <http://example.org/> . ex:x ex:y ex:z .',
        );
        const drifted = await map.readState('big');
        expect(drifted.mode).toBe('disk-backed');
        if (drifted.mode !== 'disk-backed') throw new Error('narrow');
        expect(drifted.state).toBe('stale');
        expect(drifted.disk?.staleReason).toMatch(/newcomer\.ttl/);
      } finally {
        await map.close();
      }
    });

    it("returns 'stale' with a staleReason when matched files drift from the built manifest (#357)", async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      const source = registry[0] as ParsedGlobSource;
      const { indexId, pattern } = diskBackedIndexIdentity(source);
      const indexDir = globIndexDir(dir, indexId);
      await ensureGlobIndex({
        glob: pattern,
        transforms: [],
        indexDir,
        sparqlyVersion: '0.29.0',
      });
      // A newly-added file matched by the same glob: the prior manifest knew
      // nothing about it, so the comparison must surface `stale`.
      await writeFile(
        join(dir, 'newcomer.ttl'),
        '@prefix ex: <http://example.org/> . ex:x ex:y ex:z .',
      );

      const map = await EngineMap.create(registry, { configDir: dir });
      try {
        const state = await map.readState('big');
        expect(state.mode).toBe('disk-backed');
        if (state.mode !== 'disk-backed') throw new Error('narrow');
        expect(state.state).toBe('stale');
        expect(state.disk?.staleReason).toMatch(/newcomer\.ttl/);
        // Layer 3 extras still ship on stale so the page can show where the
        // mismatched index sits and what sparqly built it.
        expect(state.disk?.indexDir).toBe(indexDir);
        expect(state.disk?.indexBytes).toBeGreaterThan(0);
        expect(state.disk?.manifestSparqlyVersion).toBe('0.29.0');
      } finally {
        await map.close();
      }
    });
  });

  describe('SourceStateEmitter wiring — Source load state transitions (#354)', () => {
    const SAMPLE = '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .';

    function recordingEmitter(): {
      emitter: SourceStateEmitter;
      transitions: SourceTransition[];
    } {
      const transitions: SourceTransition[] = [];
      const emitter = new SourceStateEmitter();
      emitter.subscribe((t) => transitions.push(t));
      return { emitter, transitions };
    }

    it('an in-memory ensure() emits load-start then load-success, in that order, exactly once per first touch', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'files', glob: join(dir, '*.ttl') },
      ]);
      const rec = recordingEmitter();
      const map = await EngineMap.create(registry, {
        sourceStateEmitter: rec.emitter,
      });
      try {
        (await map.ensure('files'))._unsafeUnwrap();
        // A second ensure() is a memoized read — must not re-emit.
        (await map.ensure('files'))._unsafeUnwrap();
        expect(rec.transitions.map((t) => [t.sourceId, t.kind])).toEqual([
          ['files', 'load-start'],
          ['files', 'load-success'],
        ]);
      } finally {
        await map.close();
      }
    });

    /*
     * #357: a freshly-observed stale **Glob index** emits one `stale-detected`
     * transition over the SSE stream so all live Sources-page subscribers
     * pick it up — not only the next snapshot fetch. The cache is per-entry:
     * subsequent reads of the same stale reason do not re-emit (the page is
     * already up-to-date for that row). A *new* reason (e.g. a different
     * file changed next) re-emits so the row text refreshes.
     */
    it("emits 'stale-detected' exactly once when readState first observes a stale Glob index (#357)", async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      const source = registry[0] as ParsedGlobSource;
      const { indexId, pattern } = diskBackedIndexIdentity(source);
      const indexDir = globIndexDir(dir, indexId);
      await ensureGlobIndex({
        glob: pattern,
        transforms: [],
        indexDir,
        sparqlyVersion: '0.29.0',
      });
      // Drift the file set after the build so the next readState observes
      // staleness.
      await writeFile(
        join(dir, 'newcomer.ttl'),
        '@prefix ex: <http://example.org/> . ex:x ex:y ex:z .',
      );

      const rec = recordingEmitter();
      const map = await EngineMap.create(registry, {
        configDir: dir,
        sourceStateEmitter: rec.emitter,
      });
      try {
        // First read: stale is observed for the first time → exactly one
        // `stale-detected` transition fires.
        await map.readState('big');
        // Second read: same reason, same row payload — no re-emit.
        await map.readState('big');
        const kinds = rec.transitions
          .filter((t) => t.sourceId === 'big')
          .map((t) => t.kind);
        expect(kinds.filter((k) => k === 'stale-detected')).toEqual([
          'stale-detected',
        ]);
      } finally {
        await map.close();
      }
    });

    it('first touch of a disk-backed glob with no manifest emits build-start (and does not emit load-start — load is gated on a built index)', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      // Minimal in-process build stub. We do not need to assert on the
      // built manifest here, only on the emitted `build-start`, so a child
      // that settles successfully off the in-process Glob index builder is
      // enough — and lets `whenIdle()` drain without waiting on a real
      // subprocess.
      const spawn: SpawnIndexBuild = (id) => {
        const listeners: Array<(code: number | null) => void> = [];
        const source = registry.find(
          (s): s is ParsedGlobSource | ParsedFileSource =>
            (s.kind === 'glob' || s.kind === 'file') && s.id === id,
        );
        if (source === undefined) {
          queueMicrotask(() => listeners.forEach((l) => l(1)));
        } else {
          const { indexId, pattern } = diskBackedIndexIdentity(source);
          const indexDir = globIndexDir(dir, indexId);
          void ensureGlobIndex({
            glob: pattern,
            transforms: source.transforms ?? [],
            indexDir,
            sparqlyVersion: 'test',
          }).then((outcome) =>
            listeners.forEach((l) => l(outcome.isOk() ? 0 : 1)),
          );
        }
        return {
          on(event: 'exit', listener: (code: number | null) => void) {
            if (event === 'exit') listeners.push(listener);
          },
          kill() {
            /* tests drain via whenIdle() */
          },
        };
      };
      const rec = recordingEmitter();
      const map = await EngineMap.create(registry, {
        configDir: dir,
        spawnIndexBuild: spawn,
        sourceStateEmitter: rec.emitter,
      });
      try {
        // The first touch reports `indexing` (Err(IndexingError)) and kicks
        // a child-process build (ADR-0042). Synchronously after the touch,
        // we must have observed exactly one `build-start` for `big` — and
        // no `load-start` yet, because the load only happens once a
        // manifest exists.
        await map.ensure('big');
        await map.whenIdle();
        const kindsBeforeNextTouch = rec.transitions
          .filter((t) => t.sourceId === 'big')
          .map((t) => t.kind);
        expect(kindsBeforeNextTouch).toContain('build-start');
        expect(kindsBeforeNextTouch).not.toContain('load-start');
      } finally {
        await map.close();
      }
    });

    it('reload(id) atomically swaps StoreRef.current so an in-flight read of the old store finishes naturally (#356)', async () => {
      // Write one quad, load, capture the old store ref. Edit the file to add
      // a second quad, then reload. The captured ref's store keeps the
      // pre-reload size (in-flight queries against it finish on the old
      // snapshot); the entry's live store ref sees the new size.
      const ttl = join(dir, 'data.ttl');
      await writeFile(ttl, SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'files', glob: join(dir, '*.ttl') },
      ]);
      const map = await EngineMap.create(registry);
      try {
        (await map.ensure('files'))._unsafeUnwrap();
        const ref = map.getStoreRef('files');
        if (!ref) throw new Error('expected store ref');
        const oldStore = ref.current;
        expect(oldStore.size).toBe(1);

        // Add a second quad on disk, then reload. The captured `oldStore`
        // reference must not gain the new quad — in-flight reads against it
        // see the snapshot they started with (atomic swap contract).
        await writeFile(
          ttl,
          '@prefix ex: <http://example.org/> . ex:a ex:p ex:b . ex:c ex:p ex:d .',
        );
        const result = await map.reload('files');
        expect(result.isOk()).toBe(true);

        // The captured ref keeps its pre-reload identity AND size.
        expect(oldStore.size).toBe(1);
        // The same StoreRef object now points at the new store with size 2.
        expect(ref).toBe(map.getStoreRef('files'));
        expect(ref.current).not.toBe(oldStore);
        expect(ref.current.size).toBe(2);
      } finally {
        await map.close();
      }
    });

    it('reload(id) emits load-start then load-success in that order (#356)', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'files', glob: join(dir, '*.ttl') },
      ]);
      const rec = recordingEmitter();
      const map = await EngineMap.create(registry, {
        sourceStateEmitter: rec.emitter,
      });
      try {
        (await map.ensure('files'))._unsafeUnwrap();
        rec.transitions.length = 0;
        (await map.reload('files'))._unsafeUnwrap();
        expect(rec.transitions.map((t) => [t.sourceId, t.kind])).toEqual([
          ['files', 'load-start'],
          ['files', 'load-success'],
        ]);
      } finally {
        await map.close();
      }
    });

    it('reload(id) on a not-loaded entry behaves as a first load (idempotent admin verb, #356)', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'files', glob: join(dir, '*.ttl') },
      ]);
      const rec = recordingEmitter();
      const map = await EngineMap.create(registry, {
        sourceStateEmitter: rec.emitter,
      });
      try {
        const result = await map.reload('files');
        expect(result.isOk()).toBe(true);
        const state = await map.readState('files');
        expect(state.mode).toBe('in-memory');
        if (state.mode === 'in-memory') expect(state.state).toBe('loaded');
        expect(rec.transitions.map((t) => [t.sourceId, t.kind])).toEqual([
          ['files', 'load-start'],
          ['files', 'load-success'],
        ]);
      } finally {
        await map.close();
      }
    });

    it('unload(id) on a not-loaded entry is a silent no-op (#356)', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'files', glob: join(dir, '*.ttl') },
      ]);
      const rec = recordingEmitter();
      const map = await EngineMap.create(registry, {
        sourceStateEmitter: rec.emitter,
      });
      try {
        await map.unload('files');
        expect(rec.transitions).toEqual([]);
        expect(map.getStoreRef('files')).toBeUndefined();
      } finally {
        await map.close();
      }
    });

    it('unload(id) clears the loaded entry so readState reports not-loaded again and the StoreRef goes away (#356)', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'files', glob: join(dir, '*.ttl') },
      ]);
      const map = await EngineMap.create(registry);
      try {
        (await map.ensure('files'))._unsafeUnwrap();
        expect(map.getStoreRef('files')).toBeDefined();
        const loadedState = await map.readState('files');
        if (loadedState.mode !== 'in-memory') throw new Error('narrow');
        expect(loadedState.state).toBe('loaded');

        await map.unload('files');

        // The entry is back at rest: no live store ref, no metrics, and the
        // next readState reports not-loaded — the next ensure() must re-load
        // from scratch rather than reusing the unloaded engine.
        expect(map.getStoreRef('files')).toBeUndefined();
        const restState = await map.readState('files');
        expect(restState).toEqual({ mode: 'in-memory', state: 'not-loaded' });

        const reloaded = (await map.ensure('files'))._unsafeUnwrap();
        const exec = await reloaded.execute('SELECT ?s WHERE { ?s ?p ?o }', {
          format: 'json',
        });
        const json = JSON.parse(exec.body) as {
          results: { bindings: Array<{ s: { value: string } }> };
        };
        expect(json.results.bindings.map((b) => b.s.value)).toEqual([
          'http://example.org/a',
        ]);
      } finally {
        await map.close();
      }
    });

    it('unload(id) emits an `unload` transition after clearing the in-memory entry (#356)', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'files', glob: join(dir, '*.ttl') },
      ]);
      const rec = recordingEmitter();
      const map = await EngineMap.create(registry, {
        sourceStateEmitter: rec.emitter,
      });
      try {
        (await map.ensure('files'))._unsafeUnwrap();
        rec.transitions.length = 0; // ignore the load transitions
        await map.unload('files');
        expect(rec.transitions.map((t) => [t.sourceId, t.kind])).toEqual([
          ['files', 'unload'],
        ]);
      } finally {
        await map.close();
      }
    });

    it('a failing in-memory ensure() emits load-start then load-failure', async () => {
      // A malformed-turtle file forces resolveSourceResult to err with a
      // `glob-load` SourceError. The self-healing path (#290) clears the
      // memoized load so a follow-up ensure() can retry; the page observes
      // `loading` → `not-loaded` via the failure edge.
      await writeFile(join(dir, 'broken.ttl'), 'this is not valid turtle .');
      const registry = parseSourceSpecs([
        { id: 'files', glob: join(dir, '*.ttl') },
      ]);
      const rec = recordingEmitter();
      const map = await EngineMap.create(registry, {
        sourceStateEmitter: rec.emitter,
      });
      try {
        const result = await map.ensure('files');
        expect(result.isErr()).toBe(true);
        expect(rec.transitions.map((t) => [t.sourceId, t.kind])).toEqual([
          ['files', 'load-start'],
          ['files', 'load-failure'],
        ]);
      } finally {
        await map.close();
      }
    });
  });
});
