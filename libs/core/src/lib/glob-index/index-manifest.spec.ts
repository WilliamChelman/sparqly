import { describe, expect, it } from 'vitest';
import { compareGlobIndexManifests, type GlobIndexManifest } from './index-manifest';

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

  it('reports stale when the transform pipeline changes', () => {
    const prior = manifest({ transforms: ['graphName'] });
    const current = manifest({ transforms: ['graphName', 'annotateSource'] });
    const verdict = compareGlobIndexManifests(prior, current);
    expect(verdict.verdict).toBe('stale');
  });
});
