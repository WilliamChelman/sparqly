import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatSourceError,
  resolveSourceResult,
} from './resolve-source-result';
import { parseSourceSpec, parseSourceSpecs } from './source-spec';
import type { GitPort } from './git/git-port';

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

  it('returns Result.ok with an empty materialized store when the glob matches no files (ADR-0028)', async () => {
    const pattern = join(dir, 'nope-*.ttl');
    const target = parseSourceSpec(pattern);

    const result = await resolveSourceResult(target);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.mode).toBe('materialized');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');
    expect(result.value.store.size).toBe(0);
    expect(result.value.files).toEqual([]);
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

describe('resolveSourceResult — pinned split-glob batches file reads', () => {
  const SHA = '0123456789abcdef0123456789abcdef01234567';
  const REPO = '/work/repo';
  const turtleFor = (path: string): string => {
    const local = path.replace(/[^a-zA-Z0-9]/g, '_');
    return `@prefix ex: <http://example.org/> . ex:${local} ex:p ex:o .`;
  };

  function makePort(): GitPort & {
    readManyAtSha: ReturnType<typeof vi.fn>;
    readFileAtSha: ReturnType<typeof vi.fn>;
  } {
    return {
      resolveRefToSha: vi.fn(async () => SHA),
      getRefObjectType: vi.fn(async () => 'tag' as const),
      readFileAtSha: vi.fn(async (_root: string, _sha: string, p: string) =>
        Buffer.from(turtleFor(p), 'utf8'),
      ),
      listFilesAtSha: vi.fn(async () => ['data/a.ttl', 'data/b.ttl']),
      readManyAtSha: vi.fn(async function* (
        _repoRoot: string,
        _sha: string,
        paths: ReadonlyArray<string>,
      ) {
        for (const path of paths) {
          yield { path, bytes: Buffer.from(turtleFor(path), 'utf8') };
        }
      }),
    } as GitPort & {
      readManyAtSha: ReturnType<typeof vi.fn>;
      readFileAtSha: ReturnType<typeof vi.fn>;
    };
  }

  it('issues a single batched readManyAtSha call (not one readFileAtSha per file) and parses every yielded blob into the store', async () => {
    const target = parseSourceSpec({
      id: 'data',
      glob: `${REPO}/data/*.ttl`,
      gitRef: 'v1.0.0',
      splitByFile: true,
    });
    const port = makePort();

    const result = await resolveSourceResult(target, {
      gitPort: port,
      repoDiscovery: { hasGitDir: (dir) => dir === REPO },
      configDir: REPO,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');
    expect(result.value.files).toHaveLength(2);
    expect(result.value.store.size).toBe(2);

    expect(port.readManyAtSha).toHaveBeenCalledTimes(1);
    const call = port.readManyAtSha.mock.calls[0];
    expect(call[0]).toBe(REPO);
    expect(call[1]).toBe(SHA);
    expect([...call[2]]).toEqual(['data/a.ttl', 'data/b.ttl']);

    expect(port.readFileAtSha).not.toHaveBeenCalled();
  });
});

describe('resolveSourceResult — transform-parse on glob target', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-rsr-xform-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns Result.err with a transform-parse variant naming the transform key when graphMode is invalid', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const target = parseSourceSpec(join(dir, '*.ttl'));

    const result = await resolveSourceResult(target, {
      graphMode: 'bogus' as unknown as 'forceAll',
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('transform-parse');
    if (result.error.kind !== 'transform-parse') throw new Error('unreachable');
    expect(result.error.transformKey).toBe('graphName');
    expect(formatSourceError(result.error)).toMatch(/graphName/);
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
