import { createHash } from 'node:crypto';
import type {
  GlobIndexManifest,
  IndexedFileEntry,
} from '../glob-index/index-manifest';

const ALGO = 'sha256';

/**
 * The materialized-source freshness token: a stable digest over the
 * `(path, size, mtime)` of every matched file. Editing a file moves its size or
 * mtime, so the digest changes and the next query is a miss. Entries are sorted
 * by path so enumeration order doesn't matter, and each field is NUL-separated
 * so no value can shift across a boundary to forge a colliding digest.
 */
export function digestFileStats(
  entries: ReadonlyArray<IndexedFileEntry>,
): string {
  const hash = createHash(ALGO);
  const sorted = [...entries].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  for (const entry of sorted) {
    hash.update(`${entry.path}\0${entry.size}\0${entry.mtimeMs}\0`);
  }
  return `stat:${hash.digest('hex')}`;
}

/**
 * The disk-backed freshness token: a content fingerprint of the Glob index
 * manifest — matched-file stats, the transform pipeline, and the sparqly version
 * — excluding the incidental `quadCount`, which the freshness contract ignores.
 * Rebuilding the index rewrites the manifest, so the token changes and the next
 * query is a miss; an unchanged index reuses the same token (a hit).
 */
export function digestGlobIndexManifest(manifest: GlobIndexManifest): string {
  const fingerprint = {
    files: manifest.files.map((file) => ({
      path: file.path,
      size: file.size,
      mtimeMs: file.mtimeMs,
    })),
    transforms: manifest.transforms,
    sparqlyVersion: manifest.sparqlyVersion,
  };
  return `manifest:${createHash(ALGO).update(JSON.stringify(fingerprint)).digest('hex')}`;
}

/**
 * The pinned-source freshness token: the resolved commit SHA folded with the set
 * of matched file paths. A moved floating ref resolves to a new SHA — a new
 * token, hence a miss — while a pinned ref is reproducibly cacheable because its
 * SHA is stable across invocations. The SHA pins file *content* but not the glob
 * *selection*: the resolved SHA is the ref's commit, independent of the glob
 * PATTERN, so widening `data/*.ttl` → `data/**\/*.ttl` at the same pin matches
 * more files without moving the SHA. Folding the matched paths in keeps the
 * broader query from being served the narrower query's cached body. Paths are
 * sorted so enumeration order doesn't matter and NUL-separated so no path can
 * shift across a boundary to forge a colliding digest.
 */
export function pinnedFreshnessToken(
  sha: string,
  files: ReadonlyArray<string> = [],
): string {
  if (files.length === 0) return `sha:${sha}`;
  const hash = createHash(ALGO);
  for (const path of [...files].sort()) {
    hash.update(`${path}\0`);
  }
  return `sha:${sha}:${hash.digest('hex')}`;
}
