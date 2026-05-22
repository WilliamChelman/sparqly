import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryEngine } from '../engine';
import { resolveSourceResult } from '../sources/resolve-source-result';
import { parseSourceSpec } from '../sources/source-spec';

/**
 * Storage-tier query parity (ADR-0041, #338): the same SPARQL query over the
 * same files must return identical results whether the glob materialized into
 * an in-memory `n3.Store` or a disk-backed Glob index — including `GRAPH ?g`
 * and `unionDefaultGraph`. Only the memory ceiling differs, never the answers.
 */
describe('storage-tier query parity', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-storage-parity-'));
    await mkdir(join(dir, 'data'));
    // A default-graph triple and a named-graph quad, so the parity queries
    // exercise both the default graph and `GRAPH ?g`.
    await writeFile(
      join(dir, 'data', 'plain.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:default .',
    );
    await writeFile(
      join(dir, 'data', 'graphed.nq'),
      '<http://example.org/a> <http://example.org/p> <http://example.org/named> <http://example.org/g> .\n',
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Runs `query` against the glob materialized at `tier`, returning sorted `?o` IRIs. */
  async function objectsFor(
    tier: 'memory' | 'disk',
    query: string,
    unionDefaultGraph: boolean,
  ): Promise<string[]> {
    const target = parseSourceSpec({
      id: 'data',
      glob: join(dir, 'data', '*'),
      storage: tier,
    });
    const resolved = await resolveSourceResult(target, {
      configDir: dir,
      sparqlyVersion: 'parity-test',
    });
    if (!resolved.isOk()) throw new Error('resolve failed');
    const sources = resolved.value;
    if (sources.mode === 'pass-through') throw new Error('unexpected mode');
    const source =
      sources.mode === 'disk-backed' ? sources.source : sources.store;
    try {
      const engine = new QueryEngine(source, undefined, { unionDefaultGraph });
      const res = await engine.execute(query);
      return (
        JSON.parse(res.body).results.bindings as Array<{
          o: { value: string };
        }>
      )
        .map((b) => b.o.value)
        .sort();
    } finally {
      if (sources.mode === 'disk-backed') await sources.close();
    }
  }

  it('a plain WHERE returns the same default-graph results on both tiers', async () => {
    const query = 'SELECT ?o WHERE { ?s ?p ?o }';
    const memory = await objectsFor('memory', query, false);
    const disk = await objectsFor('disk', query, false);

    expect(memory).toEqual(['http://example.org/default']);
    expect(disk).toEqual(memory);
  });

  it('a GRAPH ?g query returns the same named-graph results on both tiers', async () => {
    const query = 'SELECT ?o WHERE { GRAPH ?g { ?s ?p ?o } }';
    const memory = await objectsFor('memory', query, false);
    const disk = await objectsFor('disk', query, false);

    expect(memory).toEqual(['http://example.org/named']);
    expect(disk).toEqual(memory);
  });

  it('unionDefaultGraph reaches named-graph quads identically on both tiers', async () => {
    const query = 'SELECT ?o WHERE { ?s ?p ?o }';
    const memory = await objectsFor('memory', query, true);
    const disk = await objectsFor('disk', query, true);

    expect(memory).toEqual([
      'http://example.org/default',
      'http://example.org/named',
    ]);
    expect(disk).toEqual(memory);
  });
});
