import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveAnonymousSelectBindings } from './resolve-anonymous-select-bindings';

describe('resolveAnonymousSelectBindings', () => {
  let dataDir: string;
  let cwdSandbox: string;
  let originalCwd: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'sparqly-tab-data-'));
    cwdSandbox = await mkdtemp(join(tmpdir(), 'sparqly-tab-cwd-'));
    originalCwd = process.cwd();
    process.chdir(cwdSandbox);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(dataDir, { recursive: true, force: true });
    await rm(cwdSandbox, { recursive: true, force: true });
  });

  it('runs an arbitrary single-var SELECT against a glob upstream and returns one row per binding', async () => {
    const a = join(dataDir, 'a.ttl');
    await writeFile(
      a,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:p1 ex:id "1" .',
        'ex:p2 ex:id "2" .',
      ].join('\n'),
    );
    const result = await resolveAnonymousSelectBindings({
      source: { glob: a },
      query: 'PREFIX ex: <http://example.org/> SELECT ?id WHERE { ?p ex:id ?id }',
    });
    expect(result.variables).toEqual(['id']);
    const ids = result.rows
      .map((r) => r['id']?.value)
      .sort();
    expect(ids).toEqual(['1', '2']);
  });

  it('returns multi-variable rows preserving projection-order variables', async () => {
    const a = join(dataDir, 'a.ttl');
    await writeFile(
      a,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:p1 ex:id "1" ; ex:status "open" .',
        'ex:p2 ex:id "2" ; ex:status "closed" .',
      ].join('\n'),
    );
    const result = await resolveAnonymousSelectBindings({
      source: { glob: a },
      query:
        'PREFIX ex: <http://example.org/> SELECT ?id ?status WHERE { ?p ex:id ?id ; ex:status ?status }',
    });
    expect(result.variables).toEqual(['id', 'status']);
    expect(result.rows).toHaveLength(2);
    for (const row of result.rows) {
      expect(row['id']).toBeDefined();
      expect(row['status']).toBeDefined();
    }
  });

  it('preserves bag multiplicity (duplicate rows are repeated, not deduplicated)', async () => {
    const a = join(dataDir, 'a.ttl');
    await writeFile(
      a,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:p1 ex:status "open" .',
        'ex:p2 ex:status "open" .',
        'ex:p3 ex:status "closed" .',
      ].join('\n'),
    );
    const result = await resolveAnonymousSelectBindings({
      source: { glob: a },
      query:
        'PREFIX ex: <http://example.org/> SELECT ?status WHERE { ?p ex:status ?status }',
    });
    const counts = new Map<string, number>();
    for (const row of result.rows) {
      const v = row['status']?.value ?? '<unbound>';
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    expect(counts.get('open')).toBe(2);
    expect(counts.get('closed')).toBe(1);
  });

  it('runs against an empty source upstream (executes whatever the query supplies, e.g. VALUES)', async () => {
    const result = await resolveAnonymousSelectBindings({
      source: { id: 'sink', empty: true },
      query: 'SELECT ?x WHERE { VALUES ?x { "a" "b" } }',
    });
    expect(result.variables).toEqual(['x']);
    const xs = result.rows.map((r) => r['x']?.value).sort();
    expect(xs).toEqual(['a', 'b']);
  });

  it('runs against a view upstream (the view scopes the data, then the SELECT runs against the view result)', async () => {
    const a = join(dataDir, 'a.ttl');
    await writeFile(
      a,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:keep ex:p ex:v .',
        'ex:drop ex:p ex:v .',
      ].join('\n'),
    );
    const result = await resolveAnonymousSelectBindings({
      source: {
        id: 'kept',
        from: '@raw',
        query:
          'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s = ex:keep) }',
      },
      registry: [{ id: 'raw', glob: a }],
      query: 'SELECT ?s WHERE { ?s ?p ?o }',
    });
    expect(result.rows.map((r) => r['s']?.value)).toEqual([
      'http://example.org/keep',
    ]);
  });

  it('rejects ASK/DESCRIBE/UPDATE under the tabular-anon validator', async () => {
    const a = join(dataDir, 'a.ttl');
    await writeFile(a, '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .');
    await expect(
      resolveAnonymousSelectBindings({
        source: { glob: a },
        query: 'ASK { ?s ?p ?o }',
      }),
    ).rejects.toThrow(/ASK/);
  });

  it('errors when both query and queryFile are supplied', async () => {
    const a = join(dataDir, 'a.ttl');
    await writeFile(a, '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .');
    await expect(
      resolveAnonymousSelectBindings({
        source: { glob: a },
        query: 'SELECT ?s WHERE { ?s ?p ?o }',
        queryFile: 'q.rq',
      }),
    ).rejects.toThrow(/mutually exclusive/);
  });
});
