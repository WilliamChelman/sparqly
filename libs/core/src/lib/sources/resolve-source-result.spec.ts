import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from 'n3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryEngine } from '../engine';
import {
  formatSourceError,
  resolveSourceResult,
} from './resolve-source-result';
import { parseSourceSpec, type ParsedFileSource } from './source-spec';
import type { TransformDefinition } from './transform-spec';
import type { GitPort } from './git/git-port';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from '../test/fake-sparql-endpoint';

const SPARQL_JSON_TWO_BINDINGS = JSON.stringify({
  head: { vars: ['s', 'p', 'o'] },
  results: {
    bindings: [
      {
        s: { type: 'uri', value: 'http://example.org/a' },
        p: { type: 'uri', value: 'http://example.org/p' },
        o: { type: 'uri', value: 'http://example.org/b' },
      },
    ],
  },
});

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

  it('exposes the resolved SHA on the materialized result so the query cache can key on it (#415)', async () => {
    const target = parseSourceSpec({
      id: 'data',
      glob: `${REPO}/data/*.ttl`,
      gitRef: 'v1.0.0',
      splitByFile: true,
    });

    const result = await resolveSourceResult(target, {
      gitPort: makePort(),
      repoDiscovery: { hasGitDir: (dir) => dir === REPO },
      configDir: REPO,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');
    expect(result.value.resolvedSha).toBe(SHA);
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

describe('resolveSourceResult — disk-backed glob target (ADR-0041)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-rsr-disk-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves a `storage: disk` glob into a disk-backed queryable source', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const target = parseSourceSpec({
      id: 'data',
      glob: join(dir, '*.ttl'),
      storage: 'disk',
    });

    const result = await resolveSourceResult(target, {
      configDir: dir,
      sparqlyVersion: '9.9.9-test',
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.mode).toBe('disk-backed');
    if (result.value.mode !== 'disk-backed') throw new Error('unreachable');
    try {
      const engine = new QueryEngine(result.value.source);
      const res = await engine.execute('SELECT ?s WHERE { ?s ?p ?o }');
      const subjects = JSON.parse(res.body).results.bindings.map(
        (b: { s: { value: string } }) => b.s.value,
      );
      expect(subjects).toEqual(['http://example.org/a']);
    } finally {
      await result.value.close();
    }
  });
});

describe('resolveSourceResult — disk-backed file child (ADR-0041)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-rsr-disk-file-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves a `storage: disk` file child into its own disk-backed queryable source', async () => {
    const filePath = join(dir, 'a.ttl');
    await writeFile(
      filePath,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const target: ParsedFileSource = {
      kind: 'file',
      id: 'docs/a.ttl',
      path: filePath,
      parentId: 'docs',
      storage: 'disk',
    };

    const result = await resolveSourceResult(target, {
      configDir: dir,
      sparqlyVersion: '9.9.9-test',
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.mode).toBe('disk-backed');
    if (result.value.mode !== 'disk-backed') throw new Error('unreachable');
    // The child indexes under its own id — independent of any sibling.
    expect(result.value.indexDir).toContain(join('index', 'docs', 'a.ttl'));
    try {
      const engine = new QueryEngine(result.value.source);
      const res = await engine.execute('SELECT ?s WHERE { ?s ?p ?o }');
      const subjects = JSON.parse(res.body).results.bindings.map(
        (b: { s: { value: string } }) => b.s.value,
      );
      expect(subjects).toEqual(['http://example.org/a']);
    } finally {
      await result.value.close();
    }
  });

  it('resolves a `storage: memory` file child into an in-memory materialized store', async () => {
    const filePath = join(dir, 'a.ttl');
    await writeFile(
      filePath,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const target: ParsedFileSource = {
      kind: 'file',
      id: 'docs/a.ttl',
      path: filePath,
      parentId: 'docs',
      storage: 'memory',
    };

    const result = await resolveSourceResult(target, { configDir: dir });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.mode).toBe('materialized');
  });
});

// Folded from the deleted legacy `resolve-source.spec.ts` (ADR-0024 #402): the
// behavioral cases below were unique to the throw-adapter spec and have no twin
// above — preserving them avoids coverage loss when the adapter is removed.

describe('resolveSourceResult — endpoint target preserves connection details', () => {
  let endpoint: FakeSparqlEndpoint | undefined;

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
  });

  it('preserves auth/headers/timeoutMs on object-form endpoint targets and never contacts the endpoint', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON_TWO_BINDINGS,
    }));

    const target = parseSourceSpec({
      endpoint: endpoint.url,
      auth: { type: 'bearer', token: 'tk-1' },
      headers: { 'X-Tenant': 'acme' },
      timeoutMs: 1234,
    });
    const result = await resolveSourceResult(target);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.mode).toBe('pass-through');
    if (result.value.mode !== 'pass-through') throw new Error('unreachable');
    expect(result.value.endpoint.auth).toEqual({
      type: 'bearer',
      token: 'tk-1',
    });
    expect(result.value.endpoint.headers).toEqual({ 'X-Tenant': 'acme' });
    expect(result.value.endpoint.timeoutMs).toBe(1234);
    expect(endpoint.requestCount()).toBe(0);
  });
});

describe('resolveSourceResult — transform pipeline threading on glob target', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-rsr-thread-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('threads the parsed transform pipeline through the glob loader', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    // Stub transform: drop every loaded quad. Confirms the executor is wired in.
    const dropAll = {
      key: 'stubDropAll',
      parse: () => () => new Store(),
    };
    const target = parseSourceSpec(
      { glob: join(dir, '*.ttl'), transforms: [{ stubDropAll: true }] },
      { transformRegistry: [dropAll] },
    );
    const result = await resolveSourceResult(target);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');
    expect(result.value.store.size).toBe(0);
    // Files list still reflects what was matched on disk; only the Store content changed.
    expect(result.value.files).toHaveLength(1);
  });
});

describe('resolveSourceResult — file target (synthesized split-glob child)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-rsr-file-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('materializes a kind:file target into a Store with one file', async () => {
    const file = join(dir, 'alice.ttl');
    await writeFile(
      file,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const target: ParsedFileSource = {
      kind: 'file',
      id: 'docs/alice.ttl',
      path: file,
      parentId: 'docs',
    };
    const result = await resolveSourceResult(target);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');
    expect(result.value.store.size).toBe(1);
    expect(result.value.files).toEqual([file]);
  });

  it('applies the transforms pipeline to a kind:file target (mirroring the one-file glob path)', async () => {
    const file = join(dir, 'alice.ttl');
    await writeFile(
      file,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const dropAll: TransformDefinition = {
      key: 'stubDropAll',
      parse: () => () => new Store(),
    };
    // Build the file source by hand and stuff in a parsed transform; the
    // expansion code will copy these from the parent meta at synthesis time.
    const target: ParsedFileSource = {
      kind: 'file',
      id: 'docs/alice.ttl',
      path: file,
      parentId: 'docs',
      transforms: [{ key: 'stubDropAll', apply: dropAll.parse(true) }],
    };
    const result = await resolveSourceResult(target);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');
    expect(result.value.store.size).toBe(0);
    expect(result.value.files).toEqual([file]);
  });
});

describe('resolveSourceResult — annotateSource transform on glob target', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-rsr-annotate-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function fileQuads(store: Store, predicateIri: string) {
    return store.getQuads(
      null,
      { termType: 'NamedNode', value: predicateIri } as never,
      null,
      null,
    );
  }

  async function materialize(target: ReturnType<typeof parseSourceSpec>) {
    const result = await resolveSourceResult(target);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');
    return result.value.store;
  }

  it('emits source records with file:// IRI and per-(p,o) line for a Turtle source', async () => {
    const file = join(dir, 'a.ttl');
    await writeFile(
      file,
      [
        '@prefix ex: <http://example.org/> .',
        '',
        'ex:a ex:p1 ex:b ;',
        '  ex:p2 ex:c .',
        '',
      ].join('\n'),
    );
    const target = parseSourceSpec({
      glob: join(dir, '*.ttl'),
      transforms: [{ annotateSource: {} }],
    });
    const store = await materialize(target);

    const fileTriples = fileQuads(store, 'urn:sparqly:file');
    expect(fileTriples).toHaveLength(2);
    for (const q of fileTriples) {
      expect(q.object.value).toBe(`file://${file}`);
    }
    const lineTriples = fileQuads(store, 'urn:sparqly:line');
    const lineValues = lineTriples
      .map((q) => Number(q.object.value))
      .sort((a, b) => a - b);
    expect(lineValues).toEqual([3, 4]);
  });

  it('emits file-only source records (no line) for JSON-LD sources', async () => {
    const file = join(dir, 'a.jsonld');
    await writeFile(
      file,
      JSON.stringify({
        '@context': { ex: 'http://example.org/' },
        '@id': 'ex:a',
        'ex:p': { '@id': 'ex:b' },
      }),
    );
    const target = parseSourceSpec({
      glob: join(dir, '*.jsonld'),
      transforms: [{ annotateSource: {} }],
    });
    const store = await materialize(target);

    const fileTriples = fileQuads(store, 'urn:sparqly:file');
    expect(fileTriples).toHaveLength(1);
    expect(fileTriples[0].object.value).toBe(`file://${file}`);
    expect(fileQuads(store, 'urn:sparqly:line')).toHaveLength(0);
  });

  it('emits no source records when annotateSource is not listed', async () => {
    const file = join(dir, 'a.ttl');
    await writeFile(
      file,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const target = parseSourceSpec(join(dir, '*.ttl'));
    const store = await materialize(target);

    expect(fileQuads(store, 'urn:sparqly:source')).toHaveLength(0);
    expect(fileQuads(store, 'urn:sparqly:file')).toHaveLength(0);
    expect(fileQuads(store, 'urn:sparqly:line')).toHaveLength(0);
  });

  it('emits two records under one quoted-triple subject when the same triple lives in two files (graphName: preserve)', async () => {
    const a = join(dir, 'a.ttl');
    const b = join(dir, 'b.ttl');
    const triple = '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .';
    await writeFile(a, triple);
    await writeFile(b, triple);

    const target = parseSourceSpec({
      glob: join(dir, '*.ttl'),
      transforms: [{ graphName: 'preserve' }, { annotateSource: {} }],
    });
    const store = await materialize(target);

    const sourceTriples = fileQuads(store, 'urn:sparqly:source');
    expect(sourceTriples).toHaveLength(2);
    // Both source quads share the same quoted-triple subject term.
    expect(sourceTriples[0].subject.equals(sourceTriples[1].subject)).toBe(true);
    // The blank-node records differ.
    expect(sourceTriples[0].object.equals(sourceTriples[1].object)).toBe(false);

    // Each record points to its own file.
    const fileIris = fileQuads(store, 'urn:sparqly:file')
      .map((q) => q.object.value)
      .sort();
    expect(fileIris).toEqual([`file://${a}`, `file://${b}`]);
  });

  it('honours custom predicate IRI overrides end-to-end', async () => {
    const file = join(dir, 'a.ttl');
    await writeFile(
      file,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const target = parseSourceSpec({
      glob: join(dir, '*.ttl'),
      transforms: [
        {
          annotateSource: {
            source: 'http://my/source',
            file: 'http://my/file',
            line: 'http://my/line',
          },
        },
      ],
    });
    const store = await materialize(target);

    expect(fileQuads(store, 'http://my/source')).toHaveLength(1);
    expect(fileQuads(store, 'http://my/file')).toHaveLength(1);
    expect(fileQuads(store, 'http://my/line')).toHaveLength(1);
    // Defaults are not emitted when overridden.
    expect(fileQuads(store, 'urn:sparqly:source')).toHaveLength(0);
    expect(fileQuads(store, 'urn:sparqly:file')).toHaveLength(0);
    expect(fileQuads(store, 'urn:sparqly:line')).toHaveLength(0);
  });
});
