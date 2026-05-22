import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SparqlyLogFields, SparqlyLogger } from 'common';
import { parseSourceSpecs, type ParsedSource } from 'core';
import { EngineMap } from './engine-map';

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

  describe('disk-backed glob (storage: disk) — background index build, ADR-0041 / #340', () => {
    const SAMPLE =
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .';
    const SELECT = 'SELECT ?s WHERE { ?s ?p ?o }';

    function subjects(body: string): string[] {
      const json = JSON.parse(body) as {
        results: { bindings: Array<{ s: { value: string } }> };
      };
      return json.results.bindings.map((b) => b.s.value);
    }

    it('first touch of a disk-backed glob with no built index returns an `indexing` error rather than blocking on the build', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);

      const map = await EngineMap.create(registry, { configDir: dir });
      try {
        // The build runs in the background — first touch reports `indexing`
        // immediately instead of awaiting the (potentially ~15-min) build.
        const result = await map.ensure('big');
        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error.kind).toBe('indexing');
      } finally {
        await map.whenIdle();
        await map.close();
      }
    });

    it('once the background build completes, ensure() returns a ready engine that answers SPARQL against the disk-backed index', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);

      const map = await EngineMap.create(registry, { configDir: dir });
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

    it('an already-built index opens straight to `ready` on first touch — no `indexing` error', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);

      // First server lifetime: builds the index, then releases its lock.
      const builder = await EngineMap.create(registry, { configDir: dir });
      await builder.ensure('big');
      await builder.whenIdle();
      await builder.close();

      // Second server lifetime over the same configDir: the index is present,
      // so the very first touch resolves `ready` with no background build.
      const rec = recordingLogger();
      const map = await EngineMap.create(registry, {
        configDir: dir,
        logger: rec.logger,
      });
      try {
        const result = await map.ensure('big');
        expect(result.isOk()).toBe(true);
        const exec = await result
          ._unsafeUnwrap()
          .execute(SELECT, { format: 'json' });
        expect(subjects(exec.body)).toEqual(['http://example.org/a']);
        expect(
          rec.entries.filter((e) => e.msg === 'index-build-start'),
        ).toHaveLength(0);
      } finally {
        await map.whenIdle();
        await map.close();
      }
    });

    it('a failed index build clears the slot so a later ensure() retries the build — fix-the-file → success', async () => {
      const ttl = join(dir, 'data.ttl');
      await writeFile(ttl, 'this is not valid turtle .');
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);

      const map = await EngineMap.create(registry, { configDir: dir });
      try {
        const first = await map.ensure('big');
        expect(first.isErr()).toBe(true);
        await map.whenIdle(); // background build fails on the broken file

        // Self-heal: fix the file, no restart. The cleared slot retries.
        await writeFile(ttl, SAMPLE);
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
      } finally {
        await map.whenIdle();
        await map.close();
      }
    });

    it('two concurrent first-touch ensure() calls share one in-flight build (index-build-start logged exactly once)', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      const rec = recordingLogger();

      const map = await EngineMap.create(registry, {
        configDir: dir,
        logger: rec.logger,
      });
      try {
        const [a, b] = await Promise.all([
          map.ensure('big'),
          map.ensure('big'),
        ]);
        expect(a.isErr()).toBe(true);
        expect(b.isErr()).toBe(true);
        await map.whenIdle();
        expect(
          rec.entries.filter((e) => e.msg === 'index-build-start'),
        ).toHaveLength(1);
      } finally {
        await map.whenIdle();
        await map.close();
      }
    });

    it('emits index-build-start and index-build-complete boundary logs around the background build', async () => {
      await writeFile(join(dir, 'data.ttl'), SAMPLE);
      const registry = parseSourceSpecs([
        { id: 'big', glob: join(dir, '*.ttl'), storage: 'disk' },
      ]);
      const rec = recordingLogger();

      const map = await EngineMap.create(registry, {
        configDir: dir,
        logger: rec.logger,
      });
      try {
        await map.ensure('big');
        await map.whenIdle();

        const start = rec.entries.find((e) => e.msg === 'index-build-start');
        const complete = rec.entries.find(
          (e) => e.msg === 'index-build-complete',
        );
        expect(start?.fields).toMatchObject({ source: 'big' });
        expect(complete?.fields).toMatchObject({ source: 'big' });
        expect(typeof complete?.fields?.['ms']).toBe('number');
      } finally {
        await map.whenIdle();
        await map.close();
      }
    });
  });
});
