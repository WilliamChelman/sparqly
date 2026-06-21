import type { QuerySources } from '../sources/models';
import { freshnessTokenFromFacts } from './freshness-token-from-facts';

/**
 * Derives the path-aware freshness token for a resolved source (ADR-0054, #415)
 * by projecting {@link QuerySources} onto the shared freshness facts and folding
 * them into a token via {@link freshnessTokenFromFacts} — the single source of
 * truth shared with `serve` (`serveFreshnessToken`) so CLI and serve can't
 * drift. An underlying change becomes a cache miss:
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
  if (sources.mode === 'pass-through') {
    return freshnessTokenFromFacts({ mode: 'pass-through' });
  }
  if (sources.mode === 'disk-backed') {
    return freshnessTokenFromFacts({
      mode: 'disk-backed',
      indexDir: sources.indexDir,
    });
  }
  return freshnessTokenFromFacts({
    mode: 'materialized',
    resolvedSha: sources.resolvedSha,
    files: sources.files,
  });
}
