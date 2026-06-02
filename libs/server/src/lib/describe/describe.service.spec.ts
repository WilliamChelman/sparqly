import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryEngine } from '@comunica/query-sparql';
import { parseDescribeWire, serializeDescribeWire } from 'common';
import {
  parseSourceSpec,
  parseSourceSpecs,
  resolveSourceResult,
  type ParsedSource,
} from 'core';
import { Parser, Store, type Quad } from 'n3';
import {
  DescribeService,
  type DescribeRequest,
  type DescribeResult,
} from './describe.service';

const FROM_SOURCE = 'urn:sparqly:fromSource';

/**
 * Most tests only care about the ok payload, not the precondition / all-failed
 * branches. Unwraps the ResultAsync and asserts the ok branch so each test
 * stays focused on the aggregation/payload concern under test.
 */
async function describeResponse(
  svc: DescribeService,
  req: DescribeRequest,
): Promise<DescribeResult> {
  const result = await svc.runDescribe(req);
  if (result.isErr()) {
    throw new Error(
      `expected ok result; got err: ${JSON.stringify(result.error)}`,
    );
  }
  return result.value;
}

interface RegistryPaths {
  dir: string;
  alphaTtl: string;
  betaTtl: string;
  badTtl: string;
}

async function makeRegistry(): Promise<RegistryPaths> {
  const dir = await mkdtemp(join(tmpdir(), 'sparqly-describe-svc-'));
  const alphaTtl = join(dir, 'alpha.ttl');
  const betaTtl = join(dir, 'beta.ttl');
  const badTtl = join(dir, 'broken.ttl');
  // Shared quad: alice knows bob (will dedup across alpha/beta).
  // Alpha-only: alice has bnode address (Paris).
  // Beta-only: alice age 30.
  await writeFile(
    alphaTtl,
    [
      '@prefix ex: <http://example.org/> .',
      'ex:alice ex:knows ex:bob .',
      'ex:alice ex:address _:b1 .',
      '_:b1 ex:city "Paris" .',
      '',
    ].join('\n'),
  );
  await writeFile(
    betaTtl,
    [
      '@prefix ex: <http://example.org/> .',
      'ex:alice ex:knows ex:bob .',
      'ex:alice ex:age 30 .',
      '',
    ].join('\n'),
  );
  await writeFile(badTtl, 'this is not valid turtle <<<');
  return { dir, alphaTtl, betaTtl, badTtl };
}

function parseNQuads(text: string): Quad[] {
  return parseDescribeWire(text);
}

function storeFromTurtle(turtle: string): Store {
  const s = new Store();
  s.addQuads(new Parser().parse(turtle));
  return s;
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * A throwaway HTTP SPARQL endpoint backed by a real n3 `Store` (parsed from
 * Turtle), evaluating `SELECT`/`CONSTRUCT` via Comunica — `SELECT` answers in
 * `application/sparql-results+json`, `CONSTRUCT` (and the RDF-star post-pass) in
 * `serializeDescribeWire` N-Quads. Every query body is recorded on `queries` so
 * tests can assert what `describeEndpointResult` actually sent.
 */
async function startSparqlEndpoint(
  turtle: string,
): Promise<{ url: string; queries: string[]; close: () => Promise<void> }> {
  const store = storeFromTurtle(turtle);
  const engine = new QueryEngine();
  const queries: string[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      // Comunica probes a `sparql` source first with a body-less GET service
      // description request, then POSTs queries form-urlencoded; `describeEndpointResult`
      // POSTs the raw query (`application/sparql-query`). Normalise all three.
      const ct = String(req.headers['content-type'] ?? '');
      const fromUrl =
        new URL(req.url ?? '/', 'http://localhost').searchParams.get('query') ??
        '';
      const raw = ct.includes('application/x-www-form-urlencoded')
        ? new URLSearchParams(body).get('query') ?? ''
        : body || fromUrl;
      queries.push(raw);
      void (async (): Promise<void> => {
        try {
          if (raw.trim() === '') {
            // Service-description probe: an empty graph is a valid answer.
            res.writeHead(200, { 'Content-Type': 'text/turtle' });
            res.end('');
            return;
          }
          // Comunica understands RDF 1.2 triple terms `<<( … )>>`, not the
          // SPARQL 1.1-star `<< … >>` form `describeEndpointResult` sends.
          const query = raw.replace(/<<\s+(.+?)\s+>>/g, '<<( $1 )>>');
          const result = await engine.query(query, { sources: [store] });
          if (result.resultType === 'quads') {
            const quads: Quad[] = [];
            const stream = await result.execute();
            await new Promise<void>((resolve, reject) => {
              stream.on('data', (q: Quad) => quads.push(q));
              stream.on('end', () => resolve());
              stream.on('error', reject);
            });
            res.writeHead(200, { 'Content-Type': 'application/n-quads' });
            res.end(serializeDescribeWire(quads));
            return;
          }
          const { data } = await engine.resultToString(
            result,
            'application/sparql-results+json',
          );
          res.writeHead(200, {
            'Content-Type': 'application/sparql-results+json',
          });
          res.end(await streamToString(data));
        } catch (err) {
          res.writeHead(500);
          res.end(err instanceof Error ? err.message : String(err));
        }
      })();
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/sparql`,
    queries,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('DescribeService — expandedPaths (ADR-0019)', () => {
  let paths: RegistryPaths;

  beforeEach(async () => {
    paths = await makeRegistry();
  });

  afterEach(async () => {
    await rm(paths.dir, { recursive: true, force: true });
  });

  it("forwards a source's expandedPaths to that endpoint's describeEndpointResult and unions the extra hop in", async () => {
    const PIN = 'http://example.org/list';
    const ep = await startSparqlEndpoint(
      [
        '@prefix ex: <http://example.org/> .',
        'ex:alice ex:list _:b1 .',
        '_:b1 ex:value "head" .',
        '',
      ].join('\n'),
    );
    try {
      const registry = parseSourceSpecs([{ id: 'remote', endpoint: ep.url }]);
      const svc = new DescribeService(registry);

      const before = await describeResponse(svc, {
        iri: 'http://example.org/alice',
      });
      // depth-0: just the dangling `alice list _:b1` edge.
      expect(before.total).toBe(1);

      const after = await describeResponse(svc, {
        iri: 'http://example.org/alice',
        source: 'remote',
        expandedPaths: [[{ predicate: PIN, inverse: false }]],
      });
      // The path-walk query was sent and pinned the predicate.
      expect(ep.queries.some((q) => q.includes(`<${PIN}>`))).toBe(true);
      // …and the bnode's own quad is merged into the description.
      expect(after.total).toBe(2);
      expect(after.perSource.remote.count).toBe(2);
    } finally {
      await ep.close();
    }
  });

  it('clamps an over-long expansion path to the cap and reports the source truncated', async () => {
    const ep = await startSparqlEndpoint('');
    try {
      const registry = parseSourceSpecs([{ id: 'remote', endpoint: ep.url }]);
      const overLong = Array.from({ length: 30 }, () => ({
        predicate: 'http://example.org/p',
        inverse: false,
      }));
      const out = await describeResponse(new DescribeService(registry), {
        iri: 'http://example.org/alice',
        source: 'remote',
        expandedPaths: [overLong],
      });
      expect(out.perSource.remote.truncated).toBe(true);
      // The path-walk query the endpoint received was clamped to MAX steps:
      // its WHERE chains exactly MAX blank-node hops (one isBlank filter each),
      // not 30.
      const walkQuery = ep.queries.find((q) => /isBlank/i.test(q));
      expect(walkQuery).toBeDefined();
      expect((walkQuery as string).match(/isBlank/gi)).toHaveLength(12);
    } finally {
      await ep.close();
    }
  });
});

describe('DescribeService — multi-source aggregation', () => {
  let paths: RegistryPaths;
  let svc: DescribeService;

  beforeEach(async () => {
    paths = await makeRegistry();
    const registry = parseSourceSpecs([
      { id: 'alpha', glob: paths.alphaTtl },
      { id: 'beta', glob: paths.betaTtl },
    ]);
    svc = new DescribeService(registry);
  });

  afterEach(async () => {
    await rm(paths.dir, { recursive: true, force: true });
  });

  describe('default-source resolution when `source` is omitted (ADR-0052)', () => {
    it('errs with no-default-multi when 2+ sources have no default marker', async () => {
      const result = await svc.runDescribe({ iri: 'http://example.org/alice' });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe('no-default-multi');
        if (result.error.kind === 'no-default-multi') {
          expect([...result.error.availableIds].sort()).toEqual([
            'alpha',
            'beta',
          ]);
        }
      }
    });

    it('resolves to the `default: true` source and describes only that one', async () => {
      const registry = parseSourceSpecs([
        { id: 'alpha', glob: paths.alphaTtl },
        { id: 'beta', glob: paths.betaTtl, default: true },
      ]);
      const out = await describeResponse(new DescribeService(registry), {
        iri: 'http://example.org/alice',
      });
      expect(out.perSource).toHaveProperty('beta');
      expect(out.perSource).not.toHaveProperty('alpha');
    });

    it('resolves to the sole served entry even without a default marker', async () => {
      const registry = parseSourceSpecs([{ id: 'alpha', glob: paths.alphaTtl }]);
      const out = await describeResponse(new DescribeService(registry), {
        iri: 'http://example.org/alice',
      });
      expect(out.perSource).toHaveProperty('alpha');
      expect(Object.keys(out.perSource)).toEqual(['alpha']);
    });
  });

  it('runs describe against only the named source when `source` is provided', async () => {
    const out = await describeResponse(svc, {
      iri: 'http://example.org/alice',
      source: 'alpha',
    });
    expect(out.perSource).toHaveProperty('alpha');
    expect(out.perSource).not.toHaveProperty('beta');
  });

  it('accepts an `@`-prefixed source id (matches the wire convention)', async () => {
    const out = await describeResponse(svc, {
      iri: 'http://example.org/alice',
      source: '@beta',
    });
    expect(out.perSource).toHaveProperty('beta');
    expect(out.perSource).not.toHaveProperty('alpha');
  });

  it('errs with empty-target when `source` names an unknown id', async () => {
    const result = await svc.runDescribe({
      iri: 'http://example.org/alice',
      source: 'nope',
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('empty-target');
  });

  // ADR-0052: describe now targets exactly one source. The merge machinery
  // (provenance inject/strip, per-source membership) remains but is a no-op over
  // a single origin; these tests lock that single-origin behavior. Cross-source
  // dedup / per-origin attribution / cross-source bnode disjointness are no
  // longer reachable through the public interface and their tests are retired.
  describe('single-origin merge machinery (no-op over one source)', () => {
    let solo: DescribeService;

    beforeEach(() => {
      solo = new DescribeService(
        parseSourceSpecs([{ id: 'alpha', glob: paths.alphaTtl }]),
      );
    });

    it('injects one provenance annotation per quad attributed to the single source', async () => {
      const out = await describeResponse(solo, {
        iri: 'http://example.org/alice',
      });
      const wire = parseNQuads(out.quads);
      const annotations = wire.filter(
        (q) =>
          (q.subject.termType as string) === 'Quad' &&
          q.predicate.value === FROM_SOURCE,
      );
      // alpha contributes 3 quads about alice -> 3 annotations, all from alpha.
      expect(annotations).toHaveLength(out.perSource.alpha.count);
      const origins = new Set(annotations.map((q) => q.object.value));
      expect([...origins]).toEqual(['alpha']);
    });

    it('omits provenance annotations from the wire when `withProvenance: false`', async () => {
      const out = await describeResponse(solo, {
        iri: 'http://example.org/alice',
        withProvenance: false,
      });
      const wire = parseNQuads(out.quads);
      const annotations = wire.filter(
        (q) =>
          (q.subject.termType as string) === 'Quad' &&
          q.predicate.value === FROM_SOURCE,
      );
      expect(annotations).toHaveLength(0);
    });

    it('uses a request-supplied `fromSourcePredicate` instead of the default', async () => {
      const custom = 'http://my/from';
      const out = await describeResponse(solo, {
        iri: 'http://example.org/alice',
        fromSourcePredicate: custom,
      });
      const wire = parseNQuads(out.quads);
      const annotated = wire.filter(
        (q) =>
          (q.subject.termType as string) === 'Quad' &&
          q.predicate.value === custom,
      );
      expect(annotated.length).toBeGreaterThan(0);
      // And the default predicate is NOT used.
      const defaultAnnotated = wire.filter(
        (q) =>
          (q.subject.termType as string) === 'Quad' &&
          q.predicate.value === FROM_SOURCE,
      );
      expect(defaultAnnotated).toHaveLength(0);
    });

    it('returns total=0 and zero count when the seed is absent from the source', async () => {
      const out = await describeResponse(solo, {
        iri: 'http://example.org/ghost',
      });
      expect(out.total).toBe(0);
      expect(out.perSource.alpha.count).toBe(0);
      expect(out.quads.trim()).toBe('');
    });
  });

  describe('split-glob registry (ADR-0052: children count as served entries)', () => {
    async function makeSplitGlobRegistry(): Promise<{
      dir: string;
      registry: ParsedSource[];
    }> {
      const dir = await mkdtemp(join(tmpdir(), 'sparqly-describe-split-'));
      const f1 = join(dir, 'one.ttl');
      const f2 = join(dir, 'two.ttl');
      await writeFile(
        f1,
        [
          '@prefix ex: <http://example.org/> .',
          'ex:alice ex:address _:b1 .',
          '_:b1 ex:city "Paris" .',
          '',
        ].join('\n'),
      );
      await writeFile(
        f2,
        [
          '@prefix ex: <http://example.org/> .',
          'ex:alice ex:name "Alice" .',
          '',
        ].join('\n'),
      );
      const registry: ParsedSource[] = [
        { kind: 'glob', id: 'docs', glob: join(dir, '*.ttl'), splitByFile: true },
        { kind: 'file', id: 'docs/one.ttl', path: f1, parentId: 'docs' },
        { kind: 'file', id: 'docs/two.ttl', path: f2, parentId: 'docs' },
      ];
      return { dir, registry };
    }

    it('omitted `source` errs no-default-multi — meta and children are distinct served entries with no default', async () => {
      const { dir, registry } = await makeSplitGlobRegistry();
      try {
        const result = await new DescribeService(registry).runDescribe({
          iri: 'http://example.org/alice',
        });
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.kind).toBe('no-default-multi');
          if (result.error.kind === 'no-default-multi') {
            expect([...result.error.availableIds].sort()).toEqual([
              'docs',
              'docs/one.ttl',
              'docs/two.ttl',
            ]);
          }
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('explicit `source: "@docs/one.ttl"` honours the child id verbatim — meta is not also described', async () => {
      const { dir, registry } = await makeSplitGlobRegistry();
      try {
        const out = await describeResponse(new DescribeService(registry), {
          iri: 'http://example.org/alice',
          source: '@docs/one.ttl',
        });
        expect(out.perSource).toHaveProperty('docs/one.ttl');
        expect(out.perSource).not.toHaveProperty('docs');
        expect(out.perSource).not.toHaveProperty('docs/two.ttl');
        // file `one.ttl` holds the address+city quads about alice.
        expect(out.perSource['docs/one.ttl'].count).toBe(2);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('single-source failure terminal (all-sources-failed)', () => {
    it('promotes a failing source to a top-level all-sources-failed with per-source attribution', async () => {
      // `bad` points at a malformed turtle file, so resolveSourceResult surfaces a
      // real GlobLoadError. As the sole resolved source, its failure is the
      // whole describe's failure (ADR-0024 top-level Result, ADR-0052).
      const registry = parseSourceSpecs([{ id: 'bad', glob: paths.badTtl }]);
      const result = await new DescribeService(registry).runDescribe({
        iri: 'http://example.org/alice',
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe('all-sources-failed');
        if (result.error.kind === 'all-sources-failed') {
          expect(Object.keys(result.error.perSource)).toEqual(['bad']);
          expect(result.error.perSource.bad.kind).toBe('source');
        }
      }
    });
  });

  describe('per-source limit clamping', () => {
    it('clamps a request `perSourceLimit` above `perSourceHardLimit`', async () => {
      // alpha contributes 3 quads about alice; a hard ceiling of 1 truncates it.
      const registry = parseSourceSpecs([{ id: 'alpha', glob: paths.alphaTtl }]);
      const clamped = new DescribeService(registry, {
        perSourceSoftLimit: 10000,
        perSourceHardLimit: 1,
        fromSourcePredicate: FROM_SOURCE,
      });
      const out = await describeResponse(clamped, {
        iri: 'http://example.org/alice',
        perSourceLimit: 1_000_000,
      });
      expect(out.perSource.alpha.truncated).toBe(true);
      expect(out.perSource.alpha.count).toBeLessThan(3);
    });

    it('applies `perSourceSoftLimit` when the request omits `perSourceLimit`', async () => {
      const registry = parseSourceSpecs([{ id: 'alpha', glob: paths.alphaTtl }]);
      const soft = new DescribeService(registry, {
        perSourceSoftLimit: 1,
        perSourceHardLimit: 100000,
        fromSourcePredicate: FROM_SOURCE,
      });
      const out = await describeResponse(soft, {
        iri: 'http://example.org/alice',
      });
      expect(out.perSource.alpha.truncated).toBe(true);
    });

    it('falls back to the configured `fromSourcePredicate` when the request omits it', async () => {
      const registry = parseSourceSpecs([{ id: 'alpha', glob: paths.alphaTtl }]);
      const custom = 'http://configured/from';
      const configured = new DescribeService(registry, {
        perSourceSoftLimit: 10000,
        perSourceHardLimit: 100000,
        fromSourcePredicate: custom,
      });
      const out = await describeResponse(configured, {
        iri: 'http://example.org/alice',
      });
      const wire = parseNQuads(out.quads);
      const annotated = wire.filter(
        (q) =>
          (q.subject.termType as string) === 'Quad' &&
          q.predicate.value === custom,
      );
      expect(annotated.length).toBeGreaterThan(0);
    });
  });

  describe('endpoint / empty / reference dispatch', () => {
    it('dispatches an endpoint source through describeEndpointResult', async () => {
      const ep = await startSparqlEndpoint(
        '@prefix ex: <http://example.org/> .\nex:alice ex:knows ex:bob .\n',
      );
      try {
        const registry = parseSourceSpecs([{ id: 'remote', endpoint: ep.url }]);
        const out = await describeResponse(new DescribeService(registry), {
          iri: 'http://example.org/alice',
        });
        expect(out.perSource.remote.error).toBeUndefined();
        expect(out.perSource.remote.count).toBe(1);
        expect(out.total).toBe(1);
      } finally {
        await ep.close();
      }
    });

    it('surfaces an unreachable endpoint as an endpoint-describe error (promoted to all-sources-failed for the sole source)', async () => {
      const registry = parseSourceSpecs([
        { id: 'remote', endpoint: 'http://127.0.0.1:1/sparql' },
      ]);
      const result = await new DescribeService(registry).runDescribe({
        iri: 'http://example.org/alice',
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr() && result.error.kind === 'all-sources-failed') {
        const remoteErr = result.error.perSource.remote;
        expect(remoteErr.kind).toBe('endpoint-describe');
        if (remoteErr.kind === 'endpoint-describe') {
          expect(remoteErr.endpoint).toBe('http://127.0.0.1:1/sparql');
        }
      }
    });

    it('surfaces empty-source when the user explicitly names the empty source (preserved explanatory error)', async () => {
      const registry = parseSourceSpecs([
        { id: 'alpha', glob: paths.alphaTtl },
        { id: 'placeholder', empty: true },
      ]);
      const result = await new DescribeService(registry).runDescribe({
        iri: 'http://example.org/alice',
        source: 'placeholder',
      });
      // Single-source all-failed terminal: the empty-source per-source error
      // is promoted to the top level via all-sources-failed.
      expect(result.isErr()).toBe(true);
      if (result.isErr() && result.error.kind === 'all-sources-failed') {
        expect(result.error.perSource.placeholder.kind).toBe('empty-source');
      }
    });

  });

  describe('top-level precondition errors (ADR-0025)', () => {
    it('errs with seed-not-iri when iri does not look like an IRI', async () => {
      const result = await svc.runDescribe({ iri: 'not-an-iri' });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe('seed-not-iri');
        if (result.error.kind === 'seed-not-iri') {
          expect(result.error.value).toBe('not-an-iri');
        }
      }
    });

    it('errs with reference-target when `source` explicitly names a reference alias', async () => {
      const registry: ParsedSource[] = [
        { kind: 'glob', glob: paths.alphaTtl, id: 'alpha' },
        { kind: 'reference', ref: 'alpha', id: 'aliasy' },
      ];
      const result = await new DescribeService(registry).runDescribe({
        iri: 'http://example.org/alice',
        source: 'aliasy',
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.kind).toBe('reference-target');
    });

    it('errs with expanded-paths-without-source when `expandedPaths` is set but `source` is omitted', async () => {
      const result = await svc.runDescribe({
        iri: 'http://example.org/alice',
        expandedPaths: [[{ predicate: 'http://example.org/knows', inverse: false }]],
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe('expanded-paths-without-source');
      }
    });

    it('errs with expanded-paths-non-endpoint-source when `source` names a non-endpoint kind', async () => {
      const result = await svc.runDescribe({
        iri: 'http://example.org/alice',
        source: 'alpha',
        expandedPaths: [[{ predicate: 'http://example.org/knows', inverse: false }]],
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe('expanded-paths-non-endpoint-source');
        if (result.error.kind === 'expanded-paths-non-endpoint-source') {
          expect(result.error.id).toBe('alpha');
          expect(result.error.sourceKind).toBe('glob');
        }
      }
    });
  });

  describe('disk-backed dispatch', () => {
    /**
     * `describeStore` consumes an in-heap `n3.Store` synchronously; a
     * `storage: disk` glob (ADR-0041) exposes the quads via an async
     * `RDF.Source.match` stream and intentionally keeps them out of V8 — the
     * very cost the disk tier exists to escape. The previous guard fell into
     * the `mode !== 'materialized'` branch, returned `{quads:[], truncated:false}`
     * (silent wrong `count:0`), and dropped the `close()` returned by the
     * resolver — leaking the embedded LevelDB lock so the next open of the
     * index dir would fail. The boundary contract: surface a typed
     * per-source error AND release the lock before returning.
     */
    it('surfaces a typed per-source error (not silent count:0) for a disk-backed source and releases the LevelDB lock', async () => {
      // The disk-backed resolver builds its index under
      // `<configDir>/.sparqly/index/<id>/`, defaulting `configDir` to
      // `process.cwd()`. Sandbox cwd so the index lives inside the test temp dir.
      const cwdSandbox = await mkdtemp(join(tmpdir(), 'sparqly-describe-disk-'));
      const originalCwd = process.cwd();
      process.chdir(cwdSandbox);
      try {
        const registry = parseSourceSpecs([
          { id: 'big', glob: paths.alphaTtl, storage: 'disk' },
        ]);
        const result = await new DescribeService(registry).runDescribe({
          iri: 'http://example.org/alice',
          source: 'big',
        });

        // Single-source, all failed -> top-level all-sources-failed carries
        // the per-source disk-backed error.
        expect(result.isErr()).toBe(true);
        if (!result.isErr()) throw new Error('unreachable');
        expect(result.error.kind).toBe('all-sources-failed');
        if (result.error.kind !== 'all-sources-failed')
          throw new Error('unreachable');
        const per = result.error.perSource['big'];
        expect(per).toBeDefined();
        expect(per.kind).toBe('disk-backed-source');

        // Lock-release check: re-resolving the same disk-backed source via
        // resolveSourceResult must succeed (a leaked LevelDB lock would
        // block reopening the index dir).
        const reopened = await resolveSourceResult(
          parseSourceSpec({
            id: 'big',
            glob: paths.alphaTtl,
            storage: 'disk',
          }),
        );
        expect(reopened.isOk()).toBe(true);
        if (reopened.isOk() && reopened.value.mode === 'disk-backed') {
          await reopened.value.close();
        }
      } finally {
        process.chdir(originalCwd);
        await rm(cwdSandbox, { recursive: true, force: true });
      }
    });
  });
});
