import { describe, expect, it } from 'vitest';
import type { GlobIndexManifest } from '../glob-index/index-manifest';
import {
  digestFileStats,
  digestGlobIndexManifest,
  pinnedFreshnessToken,
} from './freshness-token';

/**
 * The path-aware freshness token (ADR-0054, #415) folds a content fingerprint of
 * a local source into the cache key, so an underlying change is a different key
 * (a miss) rather than a stale hit. Each resolution path has its own producer:
 * materialized globs/files stat-digest their matched files, disk-backed globs
 * reuse the Glob index manifest, and pinned sources key on their resolved SHA.
 */
describe('digestFileStats', () => {
  it('changes when a matched file is edited (size or mtime moves)', () => {
    const before = digestFileStats([{ path: '/a.ttl', size: 10, mtimeMs: 1000 }]);
    const grown = digestFileStats([{ path: '/a.ttl', size: 11, mtimeMs: 1000 }]);
    const touched = digestFileStats([{ path: '/a.ttl', size: 10, mtimeMs: 2000 }]);
    expect(grown).not.toBe(before);
    expect(touched).not.toBe(before);
  });

  it('reuses the same token for the same files regardless of order', () => {
    const a = digestFileStats([
      { path: '/a.ttl', size: 10, mtimeMs: 1000 },
      { path: '/b.ttl', size: 20, mtimeMs: 2000 },
    ]);
    const b = digestFileStats([
      { path: '/b.ttl', size: 20, mtimeMs: 2000 },
      { path: '/a.ttl', size: 10, mtimeMs: 1000 },
    ]);
    expect(b).toBe(a);
  });

  it('changes when a file is added or removed', () => {
    const one = digestFileStats([{ path: '/a.ttl', size: 10, mtimeMs: 1000 }]);
    const two = digestFileStats([
      { path: '/a.ttl', size: 10, mtimeMs: 1000 },
      { path: '/b.ttl', size: 20, mtimeMs: 2000 },
    ]);
    expect(two).not.toBe(one);
  });
});

describe('digestGlobIndexManifest', () => {
  function manifest(overrides: Partial<GlobIndexManifest> = {}): GlobIndexManifest {
    return {
      files: [{ path: '/a.ttl', size: 10, mtimeMs: 1000 }],
      sparqlyVersion: '0.36.0',
      transforms: [],
      ...overrides,
    };
  }

  it('reuses the same token for an unchanged manifest', () => {
    expect(digestGlobIndexManifest(manifest())).toBe(
      digestGlobIndexManifest(manifest()),
    );
  });

  it('ignores quadCount — not part of the freshness fingerprint', () => {
    expect(digestGlobIndexManifest(manifest({ quadCount: 42 }))).toBe(
      digestGlobIndexManifest(manifest()),
    );
  });

  it('changes when matched files, transforms, or version change', () => {
    const base = digestGlobIndexManifest(manifest());
    expect(
      digestGlobIndexManifest(
        manifest({ files: [{ path: '/a.ttl', size: 11, mtimeMs: 1000 }] }),
      ),
    ).not.toBe(base);
    expect(
      digestGlobIndexManifest(manifest({ transforms: [{ key: 'graphName' }] })),
    ).not.toBe(base);
    expect(
      digestGlobIndexManifest(manifest({ sparqlyVersion: '0.37.0' })),
    ).not.toBe(base);
  });
});

describe('pinnedFreshnessToken', () => {
  it('reuses the same token for the same resolved SHA', () => {
    const sha = 'a'.repeat(40);
    expect(pinnedFreshnessToken(sha)).toBe(pinnedFreshnessToken(sha));
  });

  it('differs for a different resolved SHA (a moved floating ref)', () => {
    expect(pinnedFreshnessToken('a'.repeat(40))).not.toBe(
      pinnedFreshnessToken('b'.repeat(40)),
    );
  });
});

describe('cross-path tokens cannot collide', () => {
  it('namespaces each producer so a stat/manifest/sha value stays distinct', () => {
    expect(digestFileStats([]).startsWith('stat:')).toBe(true);
    expect(
      digestGlobIndexManifest({
        files: [],
        sparqlyVersion: '0',
        transforms: [],
      }).startsWith('manifest:'),
    ).toBe(true);
    expect(pinnedFreshnessToken('x').startsWith('sha:')).toBe(true);
  });
});
