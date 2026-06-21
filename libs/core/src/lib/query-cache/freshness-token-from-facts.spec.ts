import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  writeGlobIndexManifest,
  type GlobIndexManifest,
} from '../glob-index/index-manifest';
import { digestGlobIndexManifest } from './freshness-token';
import { freshnessTokenFromFacts } from './freshness-token-from-facts';

/**
 * `freshnessTokenFromFacts` (ADR-0054) is the single source of truth for the
 * 4-branch freshness ladder shared by the CLI (`freshnessTokenFor`) and `serve`
 * (`serveFreshnessToken`). It takes the raw facts — mode, resolvedSha, files,
 * indexDir — so both call sites compute identical tokens for equivalent inputs.
 */
describe('freshnessTokenFromFacts', () => {
  it('is empty for a pass-through source (TTL-bounded, no content fingerprint)', async () => {
    expect(await freshnessTokenFromFacts({ mode: 'pass-through' })).toBe('');
  });

  it('keys a pinned materialized source on its resolved SHA', async () => {
    const sha = 'a'.repeat(40);
    const token = await freshnessTokenFromFacts({
      mode: 'materialized',
      resolvedSha: sha,
      files: ['/data/a.ttl'],
    });
    expect(token.startsWith(`sha:${sha}`)).toBe(true);
  });

  it('differs for a widened pinned glob at the same SHA (more files matched)', async () => {
    // A pinned glob's SHA is the ref's commit, independent of the glob PATTERN.
    // Widening `data/*.ttl` → `data/**/*.ttl` selects more files but leaves the
    // SHA unchanged; folding the matched files into the token keeps the broader
    // query from being served the narrower cached body.
    const sha = 'a'.repeat(40);
    const narrow = await freshnessTokenFromFacts({
      mode: 'materialized',
      resolvedSha: sha,
      files: ['/data/a.ttl'],
    });
    const wide = await freshnessTokenFromFacts({
      mode: 'materialized',
      resolvedSha: sha,
      files: ['/data/a.ttl', '/data/nested/b.ttl'],
    });
    expect(wide).not.toBe(narrow);
  });

  it('reuses the pinned token for the same SHA and matched files', async () => {
    const sha = 'a'.repeat(40);
    const facts = {
      mode: 'materialized' as const,
      resolvedSha: sha,
      files: ['/data/b.ttl', '/data/a.ttl'],
    };
    expect(await freshnessTokenFromFacts(facts)).toBe(
      await freshnessTokenFromFacts({
        ...facts,
        files: ['/data/a.ttl', '/data/b.ttl'],
      }),
    );
  });

  describe('with real files on disk', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'sparqly-fresh-facts-'));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('stat-digests an unpinned materialized source and changes after an edit', async () => {
      const file = join(dir, 'a.ttl');
      await writeFile(file, '@prefix ex: <http://x/> . ex:a ex:p ex:b .');

      const before = await freshnessTokenFromFacts({
        mode: 'materialized',
        files: [file],
      });
      expect(before.startsWith('stat:')).toBe(true);

      await writeFile(file, '@prefix ex: <http://x/> . ex:a ex:p ex:CHANGED .');
      const after = await freshnessTokenFromFacts({
        mode: 'materialized',
        files: [file],
      });
      expect(after).not.toBe(before);
    });

    it('digests the on-disk manifest for a disk-backed source', async () => {
      const manifest: GlobIndexManifest = {
        files: [{ path: '/a.ttl', size: 10, mtimeMs: 1000 }],
        sparqlyVersion: '9.9.9',
        transforms: [],
      };
      await writeGlobIndexManifest(dir, manifest);
      expect(
        await freshnessTokenFromFacts({ mode: 'disk-backed', indexDir: dir }),
      ).toBe(digestGlobIndexManifest(manifest));
    });
  });
});
