import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseDescribeWire } from 'common';
import { parseSourceSpecs } from 'core';
import type { Quad } from 'n3';
import { DescribeService } from './describe.service';

const FROM_SOURCE = 'urn:sparqly:fromSource';

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
    const out = await svc.runDescribe({ iri: 'http://example.org/alice' });
    expect(out.perSource).toHaveProperty('alpha');
    expect(out.perSource).toHaveProperty('beta');
  });

  it('runs describe against only the requested subset when `sources` is provided', async () => {
    const out = await svc.runDescribe({
      iri: 'http://example.org/alice',
      sources: ['alpha'],
    });
    expect(out.perSource).toHaveProperty('alpha');
    expect(out.perSource).not.toHaveProperty('beta');
  });

  it('returns an empty result with zero per-source entries when `sources` is empty', async () => {
    const out = await svc.runDescribe({
      iri: 'http://example.org/alice',
      sources: [],
    });
    expect(out.total).toBe(0);
    expect(out.quads.trim()).toBe('');
    expect(Object.keys(out.perSource)).toEqual([]);
  });

  it('dedupes IRI-only quads across sources (alice knows bob counted once in total) but counts each source under perSource.count', async () => {
    const out = await svc.runDescribe({ iri: 'http://example.org/alice' });
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
    const out = await svc.runDescribe({ iri: 'http://example.org/alice' });
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

    const out = await localSvc.runDescribe({ iri: 'http://example.org/alice' });
    // Two ex:alice ex:has _:X quads (one per source, distinct bnodes) +
    // two _:X ex:tag literal quads = 4 merged quads.
    expect(out.total).toBe(4);
    expect(out.perSource.a.count).toBe(2);
    expect(out.perSource.b.count).toBe(2);
    await rm(dir, { recursive: true, force: true });
  });

  it('omits provenance annotations from the wire when `withProvenance: false`', async () => {
    const out = await svc.runDescribe({
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

  it("uses a request-supplied `fromSourcePredicate` instead of the default", async () => {
    const custom = 'http://my/from';
    const out = await svc.runDescribe({
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
    const out = await svc.runDescribe({ iri: 'http://example.org/ghost' });
    expect(out.total).toBe(0);
    expect(out.perSource.alpha.count).toBe(0);
    expect(out.perSource.beta.count).toBe(0);
    expect(out.quads.trim()).toBe('');
  });
});
