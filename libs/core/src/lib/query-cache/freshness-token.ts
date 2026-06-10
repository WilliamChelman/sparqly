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
 * The pinned-source freshness token: the resolved commit SHA. A moved floating
 * ref resolves to a new SHA — a new token, hence a miss — while a pinned ref is
 * reproducibly cacheable because its SHA is stable across invocations.
 */
export function pinnedFreshnessToken(sha: string): string {
  return `sha:${sha}`;
}
