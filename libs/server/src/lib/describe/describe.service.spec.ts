import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseDescribeWire } from 'common';
import { parseSourceSpecs, type ParsedSource } from 'core';
import type { Quad } from 'n3';
import {
  DescribeService,
  type DescribeRequest,
  type DescribeResponse,
} from './describe.service';

const FROM_SOURCE = 'urn:sparqly:fromSource';

/** Most tests only care about the response body, not the ok/all-failed status. */
async function describeResponse(
  svc: DescribeService,
  req: DescribeRequest,
): Promise<DescribeResponse> {
  return (await svc.runDescribe(req)).response;
}

interface RegistryPaths {
  dir: string;
  alphaTtl: string;
  betaTtl: string;
}

async function makeRegistry(): Promise<RegistryPaths> {
  const dir = await mkdtemp(join(tmpdir(), 'sparqly-describe-svc-'));
  const alphaTtl = join(dir, 'alpha.ttl');
  const betaTtl = join(dir, 'beta.ttl');
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
  return { dir, alphaTtl, betaTtl };
}

function parseNQuads(text: string): Quad[] {
  return parseDescribeWire(text);
}

/** A throwaway HTTP SPARQL endpoint that returns `body` for every request. */
async function startStubEndpoint(
  body: string,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/n-triples' });
      res.end(body);
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/sparql`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * A SPARQL endpoint stub that records every query body it receives and lets the
 * caller choose the response per query — used to assert what `describeEndpoint`
 * actually sends (e.g. the path-expansion `CONSTRUCT`).
 */
async function startRecordingEndpoint(
  respond: (query: string) => string,
): Promise<{ url: string; queries: string[]; close: () => Promise<void> }> {
  const queries: string[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      queries.push(body);
      res.writeHead(200, { 'Content-Type': 'application/n-triples' });
      res.end(respond(body));
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
    const ep = await startRecordingEndpoint((q) =>
      q.includes(`<${PIN}>`)
        ? '<http://example.org/alice> <http://example.org/extra> <http://example.org/thing> .\n'
        : '',
    );
    try {
      const registry = parseSourceSpecs([{ id: 'remote', endpoint: ep.url }]);
      const svc = new DescribeService(registry);

      const before = await describeResponse(svc, {
        iri: 'http://example.org/alice',
      });
      expect(before.total).toBe(0);

      const after = await describeResponse(svc, {
        iri: 'http://example.org/alice',
        expandedPaths: { remote: [[{ predicate: PIN, inverse: false }]] },
      });
      // The path-walk query was sent and pinned the predicate.
      expect(ep.queries.some((q) => q.includes(`<${PIN}>`))).toBe(true);
      // …and its quad is merged into the depth-0 description.
      expect(after.total).toBe(1);
      expect(after.perSource.remote.count).toBe(1);
    } finally {
      await ep.close();
    }
  });

  it("does not forward one source's expandedPaths to another endpoint source", async () => {
    const PIN = 'http://example.org/list';
    const target = await startRecordingEndpoint(() => '');
    const other = await startRecordingEndpoint(() => '');
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
    const ep = await startRecordingEndpoint(() => '');
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
      // its WHERE chains exactly MAX `?mN` variables, not 30.
      const walkQuery = ep.queries.find((q) => /\?m1\b/.test(q));
      expect(walkQuery).toBeDefined();
      const maxVarIndex = Math.max(
        ...[...(walkQuery as string).matchAll(/\?m(\d+)\b/g)].map((m) =>
          Number(m[1]),
        ),
      );
      expect(maxVarIndex).toBe(12);
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

  it('defaults to all glob sources when `sources` is omitted', async () => {
    const out = await describeResponse(svc, { iri: 'http://example.org/alice' });
    expect(out.perSource).toHaveProperty('alpha');
    expect(out.perSource).toHaveProperty('beta');
  });

  it('runs describe against only the requested subset when `sources` is provided', async () => {
    const out = await describeResponse(svc, {
      iri: 'http://example.org/alice',
      sources: ['alpha'],
    });
    expect(out.perSource).toHaveProperty('alpha');
    expect(out.perSource).not.toHaveProperty('beta');
  });

  it('returns an empty result with zero per-source entries when `sources` is empty', async () => {
    const out = await describeResponse(svc, {
      iri: 'http://example.org/alice',
      sources: [],
    });
    expect(out.total).toBe(0);
    expect(out.quads.trim()).toBe('');
    expect(Object.keys(out.perSource)).toEqual([]);
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

  describe('partial failure', () => {
    function registryWithBadSource(): DescribeService {
      // `bad`'s glob matches nothing, so resolveSource throws "No files matched".
      const registry = parseSourceSpecs([
        { id: 'alpha', glob: paths.alphaTtl },
        { id: 'bad', glob: join(paths.dir, 'does-not-exist', '*.ttl') },
      ]);
      return new DescribeService(registry);
    }

    it('does not fail the whole describe when one source throws; other sources still contribute', async () => {
      const out = await describeResponse(registryWithBadSource(), {
        iri: 'http://example.org/alice',
      });
      expect(out.perSource.alpha.count).toBeGreaterThan(0);
      expect(out.perSource.bad.count).toBe(0);
      expect(out.perSource.bad.error).toBeTruthy();
    });

    it("reports status 'ok' when at least one source succeeded", async () => {
      const result = await registryWithBadSource().runDescribe({
        iri: 'http://example.org/alice',
      });
      expect(result.status).toBe('ok');
    });

    it("reports status 'all-sources-failed' with the per-source error map when every selected source threw", async () => {
      const registry = parseSourceSpecs([
        { id: 'bad1', glob: join(paths.dir, 'nope1', '*.ttl') },
        { id: 'bad2', glob: join(paths.dir, 'nope2', '*.ttl') },
      ]);
      const result = await new DescribeService(registry).runDescribe({
        iri: 'http://example.org/alice',
      });
      expect(result.status).toBe('all-sources-failed');
      expect(result.response.total).toBe(0);
      expect(result.response.quads.trim()).toBe('');
      expect(result.response.perSource.bad1.error).toBeTruthy();
      expect(result.response.perSource.bad2.error).toBeTruthy();
    });

    it("reports status 'ok' (not all-failed) when zero sources are selected", async () => {
      const result = await svc.runDescribe({
        iri: 'http://example.org/alice',
        sources: [],
      });
      expect(result.status).toBe('ok');
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
      const ep = await startStubEndpoint(
        '<http://example.org/alice> <http://example.org/knows> <http://example.org/bob> .\n',
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

    it('surfaces an unreachable endpoint as a per-source error while a sibling glob still contributes', async () => {
      const registry = parseSourceSpecs([
        { id: 'alpha', glob: paths.alphaTtl },
        { id: 'remote', endpoint: 'http://127.0.0.1:1/sparql' },
      ]);
      const result = await new DescribeService(registry).runDescribe({
        iri: 'http://example.org/alice',
      });
      expect(result.status).toBe('ok');
      expect(result.response.perSource.alpha.count).toBeGreaterThan(0);
      expect(result.response.perSource.remote.error).toBeTruthy();
    });

    it('rejects an empty source with guidance pointing at a scoping view', async () => {
      const registry = parseSourceSpecs([
        { id: 'alpha', glob: paths.alphaTtl },
        { id: 'placeholder', empty: true },
      ]);
      const out = await describeResponse(new DescribeService(registry), {
        iri: 'http://example.org/alice',
      });
      expect(out.perSource.placeholder.count).toBe(0);
      expect(out.perSource.placeholder.error).toMatch(/empty source/i);
      expect(out.perSource.placeholder.error).toMatch(/view/i);
      // The sibling glob is unaffected.
      expect(out.perSource.alpha.count).toBeGreaterThan(0);
    });

    it('rejects a reference (alias) source with a per-source error', async () => {
      const registry: ParsedSource[] = [
        { kind: 'glob', glob: paths.alphaTtl, id: 'alpha' },
        { kind: 'reference', ref: 'alpha', id: 'aliasy' },
      ];
      const out = await describeResponse(new DescribeService(registry), {
        iri: 'http://example.org/alice',
      });
      expect(out.perSource.aliasy.error).toMatch(/reference/i);
      expect(out.perSource.alpha.count).toBeGreaterThan(0);
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
        sources: ['projected'],
      });
      expect(out.perSource.projected.error).toBeUndefined();
      // alpha carries 3 quads about alice: knows bob, address _:b1, _:b1 city.
      expect(out.perSource.projected.count).toBe(3);
      expect(out.total).toBe(3);
    });

    it('describes a view whose upstream is an endpoint', async () => {
      const ep = await startStubEndpoint(
        '<http://example.org/alice> <http://example.org/knows> <http://example.org/bob> .\n',
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
        sources: ['projected'],
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
