import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataFactory } from 'n3';
import { Quadstore } from 'quadstore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryEngine } from '../engine';
import { buildGlobIndexAtomic } from './atomic-build';
import { ensureGlobIndex } from './ensure-glob-index';
import { createGlobIndexBackend } from './glob-index-backend';
import { openGlobIndex } from './glob-index-handle';
import { indexDbDir } from './glob-index-layout';

/**
 * Coverage for {@link ensureGlobIndex} (#346): the freshness gate that the
 * `sparqly index` command runs per disk-backed source — a fresh index is
 * skipped, a stale or absent one is rebuilt, and `force` rebuilds regardless.
 */
describe('ensureGlobIndex', () => {
  let dir: string;
  const SPARQLY_VERSION = '9.9.9-test';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-ensure-index-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Writes a quad into the built index that appears in no source file. */
  async function stampSentinel(indexDir: string): Promise<void> {
    const store = new Quadstore({
      backend: createGlobIndexBackend(indexDbDir(indexDir)),
      dataFactory: DataFactory,
    });
    await store.open();
    try {
      await store.multiPut([
        DataFactory.quad(
          DataFactory.namedNode('urn:sparqly:sentinel'),
          DataFactory.namedNode('http://example.org/p'),
          DataFactory.namedNode('http://example.org/b'),
        ),
      ]);
    } finally {
      await store.close();
    }
  }

  async function subjectsOf(indexDir: string): Promise<string[]> {
    const handle = await openGlobIndex(indexDir);
    try {
      const engine = new QueryEngine(handle.source);
      const result = await engine.execute('SELECT ?s WHERE { ?s ?p ?o }');
      return JSON.parse(result.body)
        .results.bindings.map((b: { s: { value: string } }) => b.s.value)
        .sort();
    } finally {
      await handle.close();
    }
  }

  it('skips a fresh index without rebuilding it', async () => {
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
    await stampSentinel(indexDir);

    const outcome = await ensureGlobIndex(options);
    expect(outcome.isOk()).toBe(true);
    if (!outcome.isOk()) throw new Error('unreachable');
    expect(outcome.value.status).toBe('skipped');

    // The sentinel survived — the fresh index was reused, not rebuilt.
    expect(await subjectsOf(indexDir)).toEqual([
      'http://example.org/a',
      'urn:sparqly:sentinel',
    ]);
  });

  it('rebuilds a stale index so it reflects the changed source', async () => {
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

    // The source changes after the index was built.
    await writeFile(
      source,
      '@prefix ex: <http://example.org/> . ex:changed ex:p ex:b .',
    );

    const outcome = await ensureGlobIndex(options);
    expect(outcome.isOk()).toBe(true);
    if (!outcome.isOk()) throw new Error('unreachable');
    expect(outcome.value.status).toBe('built');
    if (outcome.value.status !== 'built') throw new Error('unreachable');
    expect(outcome.value.trigger).toBe('stale');

    // The rebuilt index answers from the changed source.
    expect(await subjectsOf(indexDir)).toEqual(['http://example.org/changed']);
  });

  it('rebuilds a fresh index when force is set', async () => {
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
    await stampSentinel(indexDir);

    const outcome = await ensureGlobIndex({ ...options, force: true });
    expect(outcome.isOk()).toBe(true);
    if (!outcome.isOk()) throw new Error('unreachable');
    expect(outcome.value.status).toBe('built');
    if (outcome.value.status !== 'built') throw new Error('unreachable');
    expect(outcome.value.trigger).toBe('forced');

    // The forced rebuild re-read only the source files — the sentinel is gone.
    expect(await subjectsOf(indexDir)).toEqual(['http://example.org/a']);
  });
});
