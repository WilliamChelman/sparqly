import {
  readGlobIndexManifest,
  snapshotIndexedFiles,
} from '../glob-index/index-manifest';
import type { QuerySources } from '../sources/models';
import {
  digestFileStats,
  digestGlobIndexManifest,
  pinnedFreshnessToken,
} from './freshness-token';

/**
 * Derives the path-aware freshness token for a resolved source (ADR-0054, #415).
 * Resolution exposes the facts — matched files, a resolved SHA, an index dir —
 * and this folds the right one into a token so an underlying change becomes a
 * cache miss:
 * - **endpoint** (pass-through) → empty; an opaque endpoint is bounded by TTL alone.
 * - **pinned materialized** → the resolved SHA; a moved floating ref recomputes,
 *   a pinned ref is reproducibly cacheable.
 * - **unpinned materialized** → a stat-digest of matched files; editing one recomputes.
 * - **disk-backed** → the Glob index manifest digest; rebuilding the index recomputes.
 *
 * Called only when a source has opted in, so the stat/manifest read never burdens
 * the non-cached path.
 */
export async function freshnessTokenFor(sources: QuerySources): Promise<string> {
  if (sources.mode === 'pass-through') return '';
  if (sources.mode === 'disk-backed') {
    return digestGlobIndexManifest(await readGlobIndexManifest(sources.indexDir));
  }
  if (sources.resolvedSha !== undefined) {
    return pinnedFreshnessToken(sources.resolvedSha);
  }
  return digestFileStats(await snapshotIndexedFiles(sources.files));
}
