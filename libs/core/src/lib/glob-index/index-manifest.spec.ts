import { describe, expect, it } from 'vitest';
import {
  compareGlobIndexManifests,
  manifestFromFingerprints,
  type GlobIndexManifest,
} from './index-manifest';

/**
 * Staleness detection (ADR-0041, #339). `compareGlobIndexManifests` is a pure
 * function: it takes the manifest a Glob index was built with and a manifest
 * freshly computed from the current matched file set, and yields a
 * `fresh | stale` verdict. A `stale` verdict names the change so the open path
 * can warn — sparqly never silently rebuilds an index.
 */
describe('compareGlobIndexManifests', () => {
  function manifest(overrides: Partial<GlobIndexManifest> = {}): GlobIndexManifest {
    return {
      files: [{ path: '/data/a.ttl', size: 100, mtimeMs: 1000 }],
      sparqlyVersion: '1.0.0',
      transforms: [],
      ...overrides,
    };
  }

  it('reports fresh when the current snapshot matches the prior one', () => {
    const verdict = compareGlobIndexManifests(manifest(), manifest());
    expect(verdict.verdict).toBe('fresh');
  });

  it('reports stale when a matched file is added', () => {
    const prior = manifest();
    const current = manifest({
      files: [
        { path: '/data/a.ttl', size: 100, mtimeMs: 1000 },
        { path: '/data/b.ttl', size: 50, mtimeMs: 2000 },
      ],
    });
    const verdict = compareGlobIndexManifests(prior, current);
    expect(verdict.verdict).toBe('stale');
  });

  it('reports stale when a matched file is removed', () => {
    const prior = manifest({
      files: [
        { path: '/data/a.ttl', size: 100, mtimeMs: 1000 },
        { path: '/data/b.ttl', size: 50, mtimeMs: 2000 },
      ],
    });
    const current = manifest();
    const verdict = compareGlobIndexManifests(prior, current);
    expect(verdict.verdict).toBe('stale');
  });

  it("reports stale when a matched file's mtime changes", () => {
    const prior = manifest();
    const current = manifest({
      files: [{ path: '/data/a.ttl', size: 100, mtimeMs: 9999 }],
    });
    const verdict = compareGlobIndexManifests(prior, current);
    expect(verdict.verdict).toBe('stale');
  });

  it("reports stale when a matched file's size changes", () => {
    const prior = manifest();
    // mtime is held constant — only the size differs.
    const current = manifest({
      files: [{ path: '/data/a.ttl', size: 200, mtimeMs: 1000 }],
    });
    const verdict = compareGlobIndexManifests(prior, current);
    expect(verdict.verdict).toBe('stale');
  });

  it('reports stale when the sparqly version changes', () => {
    const prior = manifest({ sparqlyVersion: '1.0.0' });
    const current = manifest({ sparqlyVersion: '2.0.0' });
    const verdict = compareGlobIndexManifests(prior, current);
    expect(verdict.verdict).toBe('stale');
  });

  it('reports stale when the transform pipeline gains a transform', () => {
    const prior = manifest({ transforms: [{ key: 'graphName' }] });
    const current = manifest({
      transforms: [{ key: 'graphName' }, { key: 'annotateSource' }],
    });
    const verdict = compareGlobIndexManifests(prior, current);
    expect(verdict.verdict).toBe('stale');
  });

  it('reports fresh when a transform keeps the same key and config', () => {
    const fingerprint = { key: 'graphName', config: { mode: 'forceAll' } };
    const verdict = compareGlobIndexManifests(
      manifest({ transforms: [fingerprint] }),
      manifest({ transforms: [{ key: 'graphName', config: { mode: 'forceAll' } }] }),
    );
    expect(verdict.verdict).toBe('fresh');
  });

  /*
   * `quadCount` (#357) is a forward-compatible additive field — it's a metric
   * the **Sources page** surfaces, not part of the freshness fingerprint. Two
   * manifests that differ only in `quadCount` must still compare fresh: a
   * recomputed manifest from the same files always has *no* `quadCount`
   * (the count is known only at ingest time), so promoting it to a
   * fingerprint would mark every reused index stale on the very next open.
   */
  it('reports fresh when the prior manifest carries quadCount and the recomputed one does not', () => {
    const verdict = compareGlobIndexManifests(
      manifest({ quadCount: 1234 }),
      manifest(),
    );
    expect(verdict.verdict).toBe('fresh');
  });

  it('reports stale when a transform keeps its key but changes its config', () => {
    // The disk-backed glob bakes `graphName` into the index; re-pointing the
    // mode means the baked graph names are wrong, so the index is stale even
    // though the pipeline key sequence is unchanged (ADR-0041).
    const prior = manifest({
      transforms: [{ key: 'graphName', config: { mode: 'forceAll' } }],
    });
    const current = manifest({
      transforms: [{ key: 'graphName', config: { mode: 'flatten' } }],
    });
    const verdict = compareGlobIndexManifests(prior, current);
    expect(verdict.verdict).toBe('stale');
  });
});

/*
 * `quadCount` (#357) is a forward-compatible additive metric carried on a
 * fresh build's manifest and surfaced on the **Sources page** as the disk-
 * backed `quads` metric. The build path is the only producer — the freshness-
 * inspect path computes manifests with no count (it never reads the index)
 * and the comparison ignores the field (see the fresh-when-only-quadCount-
 * differs test above).
 */
describe('manifestFromFingerprints — quadCount', () => {
  it('includes quadCount when the build supplied one', () => {
    const built = manifestFromFingerprints({
      files: [{ path: '/data/a.ttl', size: 100, mtimeMs: 1000 }],
      transforms: [],
      sparqlyVersion: '1.0.0',
      quadCount: 42,
    });
    expect(built.quadCount).toBe(42);
  });

  it('omits quadCount when the build did not supply one (freshness-inspect path)', () => {
    const computed = manifestFromFingerprints({
      files: [{ path: '/data/a.ttl', size: 100, mtimeMs: 1000 }],
      transforms: [],
      sparqlyVersion: '1.0.0',
    });
    expect('quadCount' in computed).toBe(false);
  });
});
