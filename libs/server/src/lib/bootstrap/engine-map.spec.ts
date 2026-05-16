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
});
