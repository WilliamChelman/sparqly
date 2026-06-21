import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from 'n3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  writeGlobIndexManifest,
  type GlobIndexManifest,
} from '../glob-index/index-manifest';
import type { QuerySources } from '../sources/models';
import type { ParsedEndpointSource } from '../sources/source-spec';
import { digestGlobIndexManifest } from './freshness-token';
import { freshnessTokenFor } from './freshness-token-for';

/**
 * `freshnessTokenFor` (ADR-0054, #415) maps a resolved {@link QuerySources} to
 * the path-aware token folded into the cache key: empty for opaque endpoints,
 * the resolved SHA for a pinned materialized source, a stat-digest of matched
 * files for an unpinned one, and the manifest digest for a disk-backed glob.
 */
describe('freshnessTokenFor', () => {
  it('is empty for an opaque endpoint (TTL-bounded, no content fingerprint)', async () => {
    const endpoint: ParsedEndpointSource = {
      kind: 'endpoint',
      endpoint: 'https://example.com/sparql',
    };
    const sources: QuerySources = { mode: 'pass-through', endpoint };
    expect(await freshnessTokenFor(sources)).toBe('');
  });

  it('keys a pinned materialized source on its resolved SHA', async () => {
    const sources: QuerySources = {
      mode: 'materialized',
      store: new Store(),
      files: ['/data/a.ttl'],
      prefixes: {},
      resolvedSha: 'a'.repeat(40),
    };
    expect((await freshnessTokenFor(sources)).startsWith(`sha:${'a'.repeat(40)}`)).toBe(
      true,
    );
  });

  it('differs when a pinned glob widens at the same SHA (more files matched)', async () => {
    // The resolved SHA is the ref's commit, independent of the glob PATTERN, so
    // widening `data/*.ttl` → `data/**/*.ttl` at the same pin matches more files
    // without moving the SHA — folding the matched files in keeps the broader
    // query from being served the narrower query's cached body.
    const sha = 'a'.repeat(40);
    const narrow: QuerySources = {
      mode: 'materialized',
      store: new Store(),
      files: ['/data/a.ttl'],
      prefixes: {},
      resolvedSha: sha,
    };
    const wide: QuerySources = {
      ...narrow,
      files: ['/data/a.ttl', '/data/nested/b.ttl'],
    };
    expect(await freshnessTokenFor(wide)).not.toBe(
      await freshnessTokenFor(narrow),
    );
  });

  describe('with real files on disk', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'sparqly-fresh-'));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('stat-digests an unpinned materialized source and changes after an edit', async () => {
      const file = join(dir, 'a.ttl');
      await writeFile(file, '@prefix ex: <http://x/> . ex:a ex:p ex:b .');
      const sources: QuerySources = {
        mode: 'materialized',
        store: new Store(),
        files: [file],
        prefixes: {},
      };

      const before = await freshnessTokenFor(sources);
      expect(before.startsWith('stat:')).toBe(true);

      await writeFile(file, '@prefix ex: <http://x/> . ex:a ex:p ex:CHANGED .');
      const after = await freshnessTokenFor(sources);
      expect(after).not.toBe(before);
    });

    it('digests the on-disk manifest for a disk-backed glob', async () => {
      const manifest: GlobIndexManifest = {
        files: [{ path: '/a.ttl', size: 10, mtimeMs: 1000 }],
        sparqlyVersion: '9.9.9',
        transforms: [],
      };
      await writeGlobIndexManifest(dir, manifest);
      const sources: QuerySources = {
        mode: 'disk-backed',
        source: new Store(),
        files: ['/a.ttl'],
        indexDir: dir,
        close: async () => undefined,
      };
      expect(await freshnessTokenFor(sources)).toBe(
        digestGlobIndexManifest(manifest),
      );
    });
  });
});
