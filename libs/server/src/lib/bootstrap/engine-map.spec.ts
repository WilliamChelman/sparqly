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

  it('exposes a working engine for a materialized glob source', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const registry = parseSourceSpecs([
      { id: 'files', glob: join(dir, '*.ttl') },
    ]);

    const map = await EngineMap.create(registry);
    try {
      expect(map.allIds()).toEqual(['files']);

      const engine = map.get('files');
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
      await map.get('files').execute('SELECT ?s WHERE { ?s ?p ?o }', {
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

  it('emits a `source-loaded` debug event per source with its load timing', async () => {
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
      const loaded = rec.entries.filter(
        (e) => e.level === 'debug' && e.msg === 'source-loaded',
      );
      expect(loaded).toHaveLength(1);
      expect(loaded[0].fields).toMatchObject({
        source: 'files',
        kind: 'glob',
        files: 1,
        quads: 1,
      });
      expect(typeof loaded[0].fields?.['ms']).toBe('number');
    } finally {
      await map.close();
    }
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

  it('fails loudly at boot when a materialized source matches no files', async () => {
    const registry = parseSourceSpecs([
      { id: 'missing', glob: join(dir, '*.does-not-exist') },
    ]);

    await expect(EngineMap.create(registry)).rejects.toThrow(/No files matched/);
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
});
