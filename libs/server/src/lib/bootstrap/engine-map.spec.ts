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

  it('two concurrent first-touch ensure() calls share one in-flight load (resolveSource runs exactly once)', async () => {
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

    it('a build child that exits non-zero clears the slot so a later ensure() retries the build — fix-the-file → success', async () => {
      const ttl = join(dir, 'data.ttl');
      await writeFile(ttl, 'this is not valid turtle .');
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      const builds = inProcessIndexBuilds(registry, dir);

      let clock = 1_000;
      const map = await EngineMap.create(registry, {
        configDir: dir,
        spawnIndexBuild: builds.spawn,
        // Short cooldown + injected clock — the fix-the-file retry must wait
        // out the post-failure backoff (see no-spawn-storm test) before the
        // pool will spawn the second build.
        indexBuildCooldownMs: 1_000,
        now: () => clock,
      });
      try {
        const first = await map.ensure('big');
        expect(first.isErr()).toBe(true);
        await map.whenIdle(); // the build child exits non-zero on the bad file

        // Self-heal: fix the file, no restart. The cleared slot retries —
        // after the cooldown window has elapsed.
        await writeFile(ttl, SAMPLE);
        clock += 1_500;
        const retry = await map.ensure('big');
        expect(retry.isErr()).toBe(true);
        if (retry.isErr()) expect(retry.error.kind).toBe('indexing');

        await map.whenIdle();
        const ready = await map.ensure('big');
        expect(ready.isOk()).toBe(true);
        const exec = await ready
          ._unsafeUnwrap()
          .execute(SELECT, { format: 'json' });
        expect(subjects(exec.body)).toEqual(['http://example.org/a']);
        // The failing first attempt and the succeeding retry each spawned a
        // child — the non-zero exit did not stick the source in `indexing`.
        expect(builds.spawned).toEqual(['big', 'big']);
      } finally {
        await map.whenIdle();
        await map.close();
      }
    });

    it('repeated touches of a permanently failing disk-backed source spawn one build per cooldown window — no process-spawn storm (code-review finding #10)', async () => {
      // A malformed RDF file: every build child exits non-zero with no
      // manifest. Without per-source backoff every HTTP touch spawned a fresh
      // `sparqly index` child — unbounded process-spawn storm.
      await writeFile(join(dir, 'data.ttl'), 'this is not valid turtle .');
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      const builds = inProcessIndexBuilds(registry, dir);

      let clock = 1_000;
      const map = await EngineMap.create(registry, {
        configDir: dir,
        spawnIndexBuild: builds.spawn,
        indexBuildCooldownMs: 60_000,
        now: () => clock,
      });
      try {
        const first = await map.ensure('big');
        expect(first.isErr()).toBe(true);
        await map.whenIdle();

        // Many HTTP touches in rapid succession while the source remains
        // broken — must not spawn another child within the cooldown.
        for (let i = 0; i < 25; i++) {
          clock += 100; // 2.5s total — well inside the 60s cooldown.
          const r = await map.ensure('big');
          expect(r.isErr()).toBe(true);
        }
        expect(builds.spawned).toEqual(['big']);
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
        expect(state).toEqual({ mode: 'in-memory', state: 'loaded' });
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
        expect(state).toEqual({ mode: 'disk-backed', state: 'not-built' });
        // Crucially: readState did not request a build (the Sources page must
        // not kick a child off the snapshot endpoint).
        // No spawned builds: we never injected a spawn, and pool.whenIdle
        // would block if one were requested — but we asserted state directly.
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
        expect(state).toEqual({ mode: 'disk-backed', state: 'ready' });
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
