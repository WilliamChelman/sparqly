import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatSourceError,
  resolveSourceResult,
} from './resolve-source-result';
import { parseSourceSpec, parseSourceSpecs } from './source-spec';

describe('resolveSourceResult — endpoint target', () => {
  it('returns Result.ok with pass-through mode for an endpoint target', async () => {
    const target = parseSourceSpec('http://example.org/sparql');
    const result = await resolveSourceResult(target);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.mode).toBe('pass-through');
    if (result.value.mode !== 'pass-through') throw new Error('unreachable');
    expect(result.value.endpoint.endpoint).toBe('http://example.org/sparql');
  });
});

describe('resolveSourceResult — reference target', () => {
  it('returns Result.err with a reference-target variant', async () => {
    const target = { kind: 'reference' as const, ref: 'raw' };
    const result = await resolveSourceResult(target);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error).toEqual({ kind: 'reference-target' });
  });

  it('formatSourceError reproduces the legacy thrown message for reference targets', () => {
    expect(formatSourceError({ kind: 'reference-target' })).toBe(
      "resolveSource: `kind: 'reference'` entries are aliases, not data, and cannot be resolved as a target",
    );
  });
});

describe('resolveSourceResult — glob target', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-rsr-glob-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('materializes a glob target into a Store with the loaded files', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const target = parseSourceSpec(join(dir, '*.ttl'));
    const result = await resolveSourceResult(target);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.mode).toBe('materialized');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');
    expect(result.value.store.size).toBe(1);
    expect(result.value.files).toHaveLength(1);
  });

  it('returns Result.err with a glob-load variant naming the glob when no files match', async () => {
    const pattern = join(dir, 'nope-*.ttl');
    const target = parseSourceSpec(pattern);

    const result = await resolveSourceResult(target);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('glob-load');
    if (result.error.kind !== 'glob-load') throw new Error('unreachable');
    expect(result.error.glob).toEqual([pattern]);
    expect(result.error.file).toBeUndefined();
  });

  it('returns Result.err with a glob-load variant naming the offending file on parse failure', async () => {
    const bad = join(dir, 'broken.ttl');
    await writeFile(bad, 'this is not valid turtle <<<');
    const pattern = join(dir, '*.ttl');
    const target = parseSourceSpec(pattern);

    const result = await resolveSourceResult(target);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('glob-load');
    if (result.error.kind !== 'glob-load') throw new Error('unreachable');
    expect(result.error.file).toBe(bad);
  });
});

describe('resolveSourceResult — empty target', () => {
  it('materializes an empty target into a fresh empty Store', async () => {
    const target = parseSourceSpec({ id: 'host', empty: true });
    const result = await resolveSourceResult(target);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.mode).toBe('materialized');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');
    expect(result.value.store.size).toBe(0);
    expect(result.value.files).toEqual([]);
  });
});

describe('resolveSourceResult — view target', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-rsr-view-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('walks the from: chain and materializes the view query result', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      [
        '@prefix ex: <http://example.org/> .',
        'ex:a ex:p ex:b .',
        'ex:c ex:p ex:d .',
      ].join('\n'),
    );

    const registry = parseSourceSpecs([
      { id: 'raw', glob: join(dir, '*.ttl') },
      {
        id: 'derived',
        from: '@raw',
        query:
          'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ex:r ?o } WHERE { ?s ex:p ?o }',
      },
    ]);
    const target = registry.find((s) => s.id === 'derived');
    if (!target) throw new Error('derived view missing from registry');

    const result = await resolveSourceResult(target, { registry });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');
    const predicates = new Set(
      result.value.store
        .getQuads(null, null, null, null)
        .map((q) => q.predicate.value),
    );
    expect(predicates.has('http://example.org/r')).toBe(true);
  });

  it('surfaces an unknown @from reference as a view-reference SourceError variant', async () => {
    const registry = parseSourceSpecs([
      {
        id: 'derived',
        from: '@missing',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);
    const target = registry.find((s) => s.id === 'derived');
    if (!target) throw new Error('derived view missing from registry');

    const result = await resolveSourceResult(target, { registry });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('view-reference');
    if (result.error.kind !== 'view-reference') throw new Error('unreachable');
    expect(result.error.viewId).toBe('derived');
    expect(result.error.ref).toBe('missing');
    expect(result.error.reason).toBe('unknown');
    expect(formatSourceError(result.error)).toContain('view "derived"');
  });

  it('surfaces a cycle on the from: chain as a view-reference cycle variant', async () => {
    const registry = parseSourceSpecs([
      {
        id: 'self',
        from: '@self',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);
    const target = registry.find((s) => s.id === 'self');
    if (!target) throw new Error('self view missing from registry');

    const result = await resolveSourceResult(target, { registry });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('view-reference');
    if (result.error.kind !== 'view-reference') throw new Error('unreachable');
    expect(result.error.reason).toBe('cycle');
  });

  it('surfaces an invalid view query as a view-validation SourceError variant', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const registry = parseSourceSpecs([
      { id: 'raw', glob: join(dir, '*.ttl') },
      {
        id: 'derived',
        from: '@raw',
        // ASK is invalid for a materialized view query
        query: 'ASK { ?s ?p ?o }',
      },
    ]);
    const target = registry.find((s) => s.id === 'derived');
    if (!target) throw new Error('derived view missing from registry');

    const result = await resolveSourceResult(target, { registry });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('view-validation');
    if (result.error.kind !== 'view-validation') throw new Error('unreachable');
    expect(result.error.viewId).toBe('derived');
    expect(formatSourceError(result.error)).toContain('view "derived"');
  });

  it('surfaces a corrupted cache entry as a cache-io SourceError variant', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const cacheDir = await mkdtemp(join(tmpdir(), 'sparqly-rsr-cache-'));
    try {
      const registry = parseSourceSpecs([
        { id: 'raw', glob: join(dir, '*.ttl') },
        {
          id: 'derived',
          from: '@raw',
          query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
          cache: { everlasting: true },
        },
      ]);
      const target = registry.find((s) => s.id === 'derived');
      if (!target) throw new Error('derived view missing from registry');

      // Prime the cache by resolving once.
      const first = await resolveSourceResult(target, { registry, cacheDir });
      expect(first.isOk()).toBe(true);

      const { readdir, writeFile: wf } = await import('node:fs/promises');
      const entries = await readdir(cacheDir);
      const metaName = entries.find((n) => n.endsWith('.meta.json'));
      if (!metaName) throw new Error('cache meta file not found after prime');
      const metaPath = join(cacheDir, metaName);
      await wf(metaPath, '{ not valid json');

      const result = await resolveSourceResult(target, { registry, cacheDir });

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) throw new Error('unreachable');
      expect(result.error.kind).toBe('cache-io');
      if (result.error.kind !== 'cache-io') throw new Error('unreachable');
      expect(result.error.cachePath).toBe(metaPath);
      expect(formatSourceError(result.error)).toContain('cache');
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
