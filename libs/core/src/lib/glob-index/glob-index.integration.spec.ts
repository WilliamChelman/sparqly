import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataFactory } from 'n3';
import { Quadstore } from 'quadstore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryEngine } from '../engine';
import { parseGraphNameTransformResult, type ParsedTransform } from '../sources';
import { recordingLogger } from '../test/recording-logger';
import { createGlobIndexBackend } from './glob-index-backend';
import { buildGlobIndex } from './glob-index-builder';
import { openGlobIndex, openOrBuildGlobIndex } from './glob-index-handle';
import { indexDbDir } from './glob-index-layout';
import { readGlobIndexManifest } from './index-manifest';

/**
 * Integration coverage for the disk-backed glob query path (ADR-0041, #338):
 * build a Glob index from fixture RDF files, open it as an RDF/JS source, and
 * query the quads back through the standard query engine.
 */
describe('disk-backed glob index', () => {
  let dir: string;
  const SPARQLY_VERSION = '9.9.9-test';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-glob-index-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function build(
    glob: string,
    indexDir: string,
    transforms: ReadonlyArray<ParsedTransform> = [],
  ) {
    return buildGlobIndex({ glob, transforms, indexDir, sparqlyVersion: SPARQLY_VERSION });
  }

  /**
   * Writes a quad into the built index that appears in no source file. A reuse
   * keeps it; a rebuild — which re-reads only the sources — would drop it.
   */
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

  it('builds an index from a Turtle file and queries the quads back', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const indexDir = join(dir, 'index');

    const built = await build(join(dir, '*.ttl'), indexDir);
    expect(built.isOk()).toBe(true);

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

  it('preserves named graphs from N-Quads through the index', async () => {
    await writeFile(
      join(dir, 'a.nq'),
      '<http://example.org/a> <http://example.org/p> <http://example.org/b> <http://example.org/g> .\n',
    );
    const indexDir = join(dir, 'index');

    const built = await build(join(dir, '*.nq'), indexDir);
    expect(built.isOk()).toBe(true);

    const handle = await openGlobIndex(indexDir);
    try {
      const engine = new QueryEngine(handle.source);
      const result = await engine.execute(
        'SELECT ?g WHERE { GRAPH ?g { ?s ?p ?o } }',
      );
      const graphs = JSON.parse(result.body).results.bindings.map(
        (b: { g: { value: string } }) => b.g.value,
      );
      expect(graphs).toEqual(['http://example.org/g']);
    } finally {
      await handle.close();
    }
  });

  it('writes a manifest recording the indexed files, sparqly version, and transforms', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const indexDir = join(dir, 'index');

    await build(join(dir, '*.ttl'), indexDir);

    const manifest = await readGlobIndexManifest(indexDir);
    expect(manifest.sparqlyVersion).toBe(SPARQLY_VERSION);
    expect(manifest.transforms).toEqual([]);
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0].path).toBe(join(dir, 'a.ttl'));
    expect(manifest.files[0].size).toBeGreaterThan(0);
    expect(typeof manifest.files[0].mtimeMs).toBe('number');
  });

  it('bakes the transform pipeline into the index at build time', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const indexDir = join(dir, 'index');

    const graphName = parseGraphNameTransformResult({
      mode: 'forceAll',
      graph: 'http://example.org/baked',
    });
    if (!graphName.isOk()) throw new Error('unreachable');
    const transforms: ParsedTransform[] = [
      { key: 'graphName', apply: graphName.value },
    ];

    const built = await build(join(dir, '*.ttl'), indexDir, transforms);
    expect(built.isOk()).toBe(true);

    const handle = await openGlobIndex(indexDir);
    try {
      const engine = new QueryEngine(handle.source);
      const result = await engine.execute(
        'SELECT ?g WHERE { GRAPH ?g { ?s ?p ?o } }',
      );
      const graphs = JSON.parse(result.body).results.bindings.map(
        (b: { g: { value: string } }) => b.g.value,
      );
      // The `graphName: forceAll` transform ran at build time — every quad
      // was rewritten into the override graph before landing in the index.
      expect(graphs).toEqual(['http://example.org/baked']);
    } finally {
      await handle.close();
    }
  });

  it('warns and reuses without rebuilding when an indexed source file changed', async () => {
    const source = join(dir, 'a.ttl');
    await writeFile(
      source,
      '@prefix ex: <http://example.org/> . ex:original ex:p ex:b .',
    );
    const indexDir = join(dir, 'index');
    const { logger, entries } = recordingLogger();
    const options = {
      glob: join(dir, '*.ttl'),
      transforms: [],
      indexDir,
      sparqlyVersion: SPARQLY_VERSION,
      logger,
    };

    const first = await openOrBuildGlobIndex(options);
    expect(first.isOk()).toBe(true);
    if (first.isOk()) await first.value.close();

    // The source file changes after the index was built.
    await writeFile(
      source,
      '@prefix ex: <http://example.org/> . ex:changed ex:p ex:b .',
    );

    const second = await openOrBuildGlobIndex(options);
    expect(second.isOk()).toBe(true);
    if (!second.isOk()) throw new Error('unreachable');
    try {
      const engine = new QueryEngine(second.value.source);
      const result = await engine.execute('SELECT ?s WHERE { ?s ?p ?o }');
      const subjects = JSON.parse(result.body).results.bindings.map(
        (b: { s: { value: string } }) => b.s.value,
      );
      // ADR-0041: a stale index is reused as-is, never silently rebuilt — so
      // the query still answers from the original build.
      expect(subjects).toEqual(['http://example.org/original']);
    } finally {
      await second.value.close();
    }
    // The staleness surfaces as exactly one warn-level boundary log.
    const warnings = entries.filter((entry) => entry.level === 'warn');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].msg).toMatch(/stale/i);
  });

  it('reuses a fresh index without warning or rebuilding when nothing changed', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const indexDir = join(dir, 'index');
    const { logger, entries } = recordingLogger();
    const options = {
      glob: join(dir, '*.ttl'),
      transforms: [],
      indexDir,
      sparqlyVersion: SPARQLY_VERSION,
      logger,
    };

    const first = await openOrBuildGlobIndex(options);
    expect(first.isOk()).toBe(true);
    if (first.isOk()) await first.value.close();

    await stampSentinel(indexDir);

    const second = await openOrBuildGlobIndex(options);
    expect(second.isOk()).toBe(true);
    if (!second.isOk()) throw new Error('unreachable');
    try {
      const engine = new QueryEngine(second.value.source);
      const result = await engine.execute('SELECT ?s WHERE { ?s ?p ?o }');
      const subjects = JSON.parse(result.body)
        .results.bindings.map((b: { s: { value: string } }) => b.s.value)
        .sort();
      // The sentinel survived — the fresh index was reused, not rebuilt.
      expect(subjects).toEqual([
        'http://example.org/a',
        'urn:sparqly:sentinel',
      ]);
    } finally {
      await second.value.close();
    }
    // Nothing changed since the build — no staleness warning.
    expect(entries.filter((entry) => entry.level === 'warn')).toEqual([]);
  });
});
