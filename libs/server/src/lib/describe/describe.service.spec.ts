import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryEngine } from '@comunica/query-sparql';
import { parseDescribeWire, serializeDescribeWire } from 'common';
import { parseSourceSpecs, type ParsedSource } from 'core';
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
 * tests can assert what `describeEndpoint` actually sent.
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
      // description request, then POSTs queries form-urlencoded; `describeEndpoint`
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
          // SPARQL 1.1-star `<< … >>` form `describeEndpoint` sends.
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

  it("forwards a source's expandedPaths to that endpoint's describeEndpoint and unions the extra hop in", async () => {
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
        expandedPaths: { remote: [[{ predicate: PIN, inverse: false }]] },
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

  it("does not forward one source's expandedPaths to another endpoint source", async () => {
    const PIN = 'http://example.org/list';
    const target = await startSparqlEndpoint('');
    const other = await startSparqlEndpoint('');
    try {
      const registry = parseSourceSpecs([
        { id: 'target', endpoint: target.url },
        { id: 'other', endpoint: other.url },
      ]);
      await describeResponse(new DescribeService(registry), {
        iri: 'http://example.org/alice',
        expandedPaths: { target: [[{ predicate: PIN, inverse: false }]] },
      });
      expect(target.queries.some((q) => q.includes(`<${PIN}>`))).toBe(true);
      expect(other.queries.some((q) => q.includes(`<${PIN}>`))).toBe(false);
    } finally {
      await target.close();
      await other.close();
    }
  });

  it('ignores expandedPaths for a materialized (glob) source — result identical to omitting it', async () => {
    const registry = parseSourceSpecs([{ id: 'alpha', glob: paths.alphaTtl }]);
    const svc = new DescribeService(registry);
    const baseline = await describeResponse(svc, {
      iri: 'http://example.org/alice',
    });
    const withPaths = await describeResponse(svc, {
      iri: 'http://example.org/alice',
      expandedPaths: {
        alpha: [[{ predicate: 'http://example.org/knows', inverse: false }]],
      },
    });
    expect(withPaths.total).toBe(baseline.total);
    expect(withPaths.perSource.alpha.count).toBe(baseline.perSource.alpha.count);
    expect(withPaths.perSource.alpha.truncated).toBe(false);
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
        expandedPaths: { remote: [overLong] },
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

  it('defaults to all glob sources when `source` is omitted', async () => {
    const out = await describeResponse(svc, { iri: 'http://example.org/alice' });
    expect(out.perSource).toHaveProperty('alpha');
    expect(out.perSource).toHaveProperty('beta');
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

  it('dedupes IRI-only quads across sources (alice knows bob counted once in total) but counts each source under perSource.count', async () => {
    const out = await describeResponse(svc, { iri: 'http://example.org/alice' });
    // alpha contributes: alice knows bob, alice address _:b1, _:b1 city "Paris" => 3
    // beta contributes:  alice knows bob, alice age 30 => 2
    // dedup: alice knows bob collapses; bnode-containing quads never collapse.
    // total = 3 (alpha unique) + 1 (beta-only: age) + 1 (shared: knows) = 5? Let's compute:
    //   shared: alice knows bob (1)
    //   alpha-only: alice address _:b1 (1) + _:b1 city Paris (1) = 2
    //   beta-only: alice age 30 (1)
    //   total = 4 merged quads.
    expect(out.total).toBe(4);
    // alpha contributed: alice knows bob (shared, counts) + 2 alpha-only = 3.
    expect(out.perSource.alpha.count).toBe(3);
    // beta contributed: alice knows bob (shared, counts) + 1 beta-only = 2.
    expect(out.perSource.beta.count).toBe(2);
    // Honest-counts invariant: sum(perSource.count) >= total.
    const sum = Object.values(out.perSource).reduce(
      (acc, e) => acc + e.count,
      0,
    );
    expect(sum).toBeGreaterThanOrEqual(out.total);
  });

  it('emits one RDF-star provenance annotation per (quad, origin-source) pair on the wire', async () => {
    const out = await describeResponse(svc, { iri: 'http://example.org/alice' });
    const wire = parseNQuads(out.quads);
    const annotations = wire.filter(
      (q) =>
        (q.subject.termType as string) === 'Quad' &&
        q.predicate.value === FROM_SOURCE,
    );
    // sum(perSource.count) = 3 + 2 = 5 annotations.
    expect(annotations).toHaveLength(5);
    const origins = new Set(annotations.map((q) => q.object.value));
    expect([...origins].sort()).toEqual(['alpha', 'beta']);
  });

  it('keeps bnode-containing quads from different sources distinct (disjoint label spaces after relabel)', async () => {
    // Both sources carry a bnode under the same lexical label `_:b1`. Without
    // the per-source relabel, the merged set would silently conflate them.
    // alpha: ex:alice ex:address _:b1 ; _:b1 ex:city "Paris".
    // beta (rewrite the fixture inline by adding a bnode quad):
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-describe-bn-'));
    const a = join(dir, 'a.ttl');
    const b = join(dir, 'b.ttl');
    await writeFile(
      a,
      '@prefix ex: <http://example.org/> . ex:alice ex:has _:b1 . _:b1 ex:tag "A" .\n',
    );
    await writeFile(
      b,
      '@prefix ex: <http://example.org/> . ex:alice ex:has _:b1 . _:b1 ex:tag "B" .\n',
    );
    const registry = parseSourceSpecs([
      { id: 'a', glob: a },
      { id: 'b', glob: b },
    ]);
    const localSvc = new DescribeService(registry);

    const out = await describeResponse(localSvc, { iri: 'http://example.org/alice' });
    // Two ex:alice ex:has _:X quads (one per source, distinct bnodes) +
    // two _:X ex:tag literal quads = 4 merged quads.
    expect(out.total).toBe(4);
    expect(out.perSource.a.count).toBe(2);
    expect(out.perSource.b.count).toBe(2);
    await rm(dir, { recursive: true, force: true });
  });

  it('omits provenance annotations from the wire when `withProvenance: false`', async () => {
    const out = await describeResponse(svc, {
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

  it('still applies the per-source bnode rewrite when `withProvenance: false` (collision avoidance is provenance-independent)', async () => {
    // Same fixture as the "keeps bnode-containing quads distinct" test: both
    // sources carry `_:b1`. With provenance off the wire has no annotations,
    // but the merged set must still see the two `_:b1`s as distinct bnodes.
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-describe-bn-noprov-'));
    const a = join(dir, 'a.ttl');
    const b = join(dir, 'b.ttl');
    await writeFile(
      a,
      '@prefix ex: <http://example.org/> . ex:alice ex:has _:b1 . _:b1 ex:tag "A" .\n',
    );
    await writeFile(
      b,
      '@prefix ex: <http://example.org/> . ex:alice ex:has _:b1 . _:b1 ex:tag "B" .\n',
    );
    const registry = parseSourceSpecs([
      { id: 'a', glob: a },
      { id: 'b', glob: b },
    ]);
    const localSvc = new DescribeService(registry);

    const out = await describeResponse(localSvc, {
      iri: 'http://example.org/alice',
      withProvenance: false,
    });
    expect(out.total).toBe(4);
    expect(out.perSource.a.count).toBe(2);
    expect(out.perSource.b.count).toBe(2);
    const wire = parseNQuads(out.quads);
    expect(
      wire.some(
        (q) =>
          (q.subject.termType as string) === 'Quad' &&
          q.predicate.value === FROM_SOURCE,
      ),
    ).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it("uses a request-supplied `fromSourcePredicate` instead of the default", async () => {
    const custom = 'http://my/from';
    const out = await describeResponse(svc, {
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

  it('returns total=0 and zero per-source counts when seed is absent from every source', async () => {
    const out = await describeResponse(svc, { iri: 'http://example.org/ghost' });
    expect(out.total).toBe(0);
    expect(out.perSource.alpha.count).toBe(0);
    expect(out.perSource.beta.count).toBe(0);
    expect(out.quads.trim()).toBe('');
  });

  describe('split-glob absorbing-meta rule (ADR-0033)', () => {
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

    it('"all" mode absorbs split-glob file children whose parent meta is served', async () => {
      const { dir, registry } = await makeSplitGlobRegistry();
      try {
        const out = await describeResponse(new DescribeService(registry), {
          iri: 'http://example.org/alice',
        });
        expect(out.perSource).toHaveProperty('docs');
        expect(out.perSource).not.toHaveProperty('docs/one.ttl');
        expect(out.perSource).not.toHaveProperty('docs/two.ttl');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('a bnode-bearing seed across split-glob meta+children yields the bnode subtree exactly once (closes duplicate-subtree hole)', async () => {
      const { dir, registry } = await makeSplitGlobRegistry();
      try {
        const out = await describeResponse(new DescribeService(registry), {
          iri: 'http://example.org/alice',
        });
        const wire = parseNQuads(out.quads);
        // The `_:b1 ex:city "Paris"` quad lives once in the source data; with
        // absorption only the meta runs, so the merged result holds it exactly
        // once. Without absorption, the meta and child describe runs would each
        // contribute a separately-labelled bnode subtree, and the count would
        // be two.
        const cityQuads = wire.filter(
          (q) => q.predicate.value === 'http://example.org/city',
        );
        expect(cityQuads).toHaveLength(1);
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

  describe('partial failure', () => {
    function registryWithBadSource(): DescribeService {
      // `bad` points at a malformed turtle file, so resolveSource surfaces a
      // real GlobLoadError. (Empty-glob is no longer a failure — ADR-0028.)
      const registry = parseSourceSpecs([
        { id: 'alpha', glob: paths.alphaTtl },
        { id: 'bad', glob: paths.badTtl },
      ]);
      return new DescribeService(registry);
    }

    it('does not fail the whole describe when one source fails; other sources still contribute (ADR-0025 user story 5)', async () => {
      const out = await describeResponse(registryWithBadSource(), {
        iri: 'http://example.org/alice',
      });
      expect(out.perSource.alpha.count).toBeGreaterThan(0);
      expect(out.perSource.bad.count).toBe(0);
      // Per-source error is a structured `DescribeError`, not an opaque string.
      expect(out.perSource.bad.error).toBeDefined();
      expect(out.perSource.bad.error?.kind).toBe('source');
    });

    it('returns an ok result when at least one source succeeded (top-level ok)', async () => {
      const result = await registryWithBadSource().runDescribe({
        iri: 'http://example.org/alice',
      });
      expect(result.isOk()).toBe(true);
    });

    it('errs with all-sources-failed carrying per-source attribution when every selected source failed (ADR-0025 user story 6)', async () => {
      const bad1 = join(paths.dir, 'bad1.ttl');
      const bad2 = join(paths.dir, 'bad2.ttl');
      await writeFile(bad1, 'not valid turtle <<<');
      await writeFile(bad2, 'still not valid turtle <<<');
      const registry = parseSourceSpecs([
        { id: 'bad1', glob: bad1 },
        { id: 'bad2', glob: bad2 },
      ]);
      const result = await new DescribeService(registry).runDescribe({
        iri: 'http://example.org/alice',
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe('all-sources-failed');
        if (result.error.kind === 'all-sources-failed') {
          expect(Object.keys(result.error.perSource).sort()).toEqual([
            'bad1',
            'bad2',
          ]);
          expect(result.error.perSource.bad1.kind).toBe('source');
          expect(result.error.perSource.bad2.kind).toBe('source');
        }
      }
    });

    it('all-sources-ok aggregation matrix: every source contributes, no per-source error fields set (ADR-0025 user story 4)', async () => {
      const out = await describeResponse(svc, {
        iri: 'http://example.org/alice',
      });
      expect(out.perSource.alpha.error).toBeUndefined();
      expect(out.perSource.beta.error).toBeUndefined();
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
    it('dispatches an endpoint source through describeEndpoint', async () => {
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

    it('surfaces an unreachable endpoint as a per-source endpoint-describe error while a sibling glob still contributes', async () => {
      const registry = parseSourceSpecs([
        { id: 'alpha', glob: paths.alphaTtl },
        { id: 'remote', endpoint: 'http://127.0.0.1:1/sparql' },
      ]);
      const result = await new DescribeService(registry).runDescribe({
        iri: 'http://example.org/alice',
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.perSource.alpha.count).toBeGreaterThan(0);
        const remoteErr = result.value.perSource.remote.error;
        expect(remoteErr).toBeDefined();
        expect(remoteErr?.kind).toBe('endpoint-describe');
        if (remoteErr?.kind === 'endpoint-describe') {
          expect(remoteErr.endpoint).toBe('http://127.0.0.1:1/sparql');
        }
      }
    });

    it('absorbs an empty source in "all" mode — it does not appear in perSource', async () => {
      const registry = parseSourceSpecs([
        { id: 'alpha', glob: paths.alphaTtl },
        { id: 'placeholder', empty: true },
      ]);
      const out = await describeResponse(new DescribeService(registry), {
        iri: 'http://example.org/alice',
      });
      expect(out.perSource).not.toHaveProperty('placeholder');
      expect(out.perSource.alpha.count).toBeGreaterThan(0);
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

    it('absorbs a reference (alias) source in "all" mode — it does not appear in perSource', async () => {
      const registry: ParsedSource[] = [
        { kind: 'glob', glob: paths.alphaTtl, id: 'alpha' },
        { kind: 'reference', ref: 'alpha', id: 'aliasy' },
      ];
      const out = await describeResponse(new DescribeService(registry), {
        iri: 'http://example.org/alice',
      });
      expect(out.perSource).not.toHaveProperty('aliasy');
      expect(out.perSource.alpha.count).toBeGreaterThan(0);
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
  });

  describe('view dispatch', () => {
    it('describes a view whose upstream is a glob (materialized then describeStore)', async () => {
      const registry = parseSourceSpecs([
        { id: 'raw', glob: paths.alphaTtl },
        {
          id: 'projected',
          from: '@raw',
          query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        },
      ]);
      const out = await describeResponse(new DescribeService(registry), {
        iri: 'http://example.org/alice',
        source: 'projected',
      });
      expect(out.perSource.projected.error).toBeUndefined();
      // alpha carries 3 quads about alice: knows bob, address _:b1, _:b1 city.
      expect(out.perSource.projected.count).toBe(3);
      expect(out.total).toBe(3);
    });

    it('describes a view whose upstream is an endpoint', async () => {
      const ep = await startSparqlEndpoint(
        '@prefix ex: <http://example.org/> .\nex:alice ex:knows ex:bob .\n',
      );
      try {
        const registry = parseSourceSpecs([
          { id: 'live', endpoint: ep.url },
          {
            id: 'overlay',
            from: '@live',
            query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
          },
        ]);
        const out = await describeResponse(new DescribeService(registry), {
          iri: 'http://example.org/alice',
          sources: ['overlay'],
        });
        expect(out.perSource.overlay.error).toBeUndefined();
        expect(out.perSource.overlay.count).toBe(1);
        expect(out.total).toBe(1);
      } finally {
        await ep.close();
      }
    });

    it('relabels a view source\'s bnodes and annotates its quads with the view id as origin', async () => {
      const registry = parseSourceSpecs([
        { id: 'raw', glob: paths.alphaTtl },
        {
          id: 'projected',
          from: '@raw',
          query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        },
      ]);
      const out = await describeResponse(new DescribeService(registry), {
        iri: 'http://example.org/alice',
        source: 'projected',
      });
      const wire = parseNQuads(out.quads);
      // Per-source bnode relabel: every bnode label is namespaced by the source id.
      const bnodeLabels = wire
        .flatMap((q) => [q.subject, q.object])
        .filter((t) => t.termType === 'BlankNode')
        .map((t) => t.value);
      expect(bnodeLabels.length).toBeGreaterThan(0);
      for (const label of bnodeLabels) {
        expect(label).toMatch(/^projected__/);
      }
      // Provenance annotation carries the view id as the origin source.
      const annotations = wire.filter(
        (q) =>
          (q.subject.termType as string) === 'Quad' &&
          q.predicate.value === FROM_SOURCE,
      );
      expect(annotations.length).toBeGreaterThan(0);
      expect(new Set(annotations.map((q) => q.object.value))).toEqual(
        new Set(['projected']),
      );
    });
  });
});
