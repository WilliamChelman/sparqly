import {
  readGlobIndexManifest,
  snapshotIndexedFiles,
} from '../glob-index/index-manifest';
import {
  digestFileStats,
  digestGlobIndexManifest,
  pinnedFreshnessToken,
} from './freshness-token';

/**
 * The raw facts the freshness ladder needs, stripped of caller-specific shapes.
 * The CLI (`QuerySources`) and `serve` (`ParsedSource` + `LoadedSources`) each
 * project their own resolution into this so both route through one ladder.
 */
export type FreshnessFacts =
  /** An opaque endpoint — bounded by TTL alone, no content fingerprint. */
  | { mode: 'pass-through' }
  /** A disk-backed glob — fingerprinted by its on-disk index manifest. */
  | { mode: 'disk-backed'; indexDir: string }
  /**
   * A materialized glob/file. A pinned source carries the resolved SHA; an
   * unpinned one omits it and falls back to a stat-digest of `files`.
   */
  | {
      mode: 'materialized';
      resolvedSha?: string;
      files: ReadonlyArray<string>;
    };

/**
 * The single source of truth for the path-aware freshness ladder (ADR-0054,
 * #415). Both `freshnessTokenFor` (CLI) and `serveFreshnessToken` (`serve`)
 * delegate here so CLI and serve compute identical keys for the same source —
 * one copy of the rules can't drift from the other:
 * - **pass-through** → empty; an opaque endpoint is bounded by TTL alone.
 * - **disk-backed** → the Glob index manifest digest; rebuilding recomputes.
 * - **pinned materialized** → the resolved SHA folded with the matched file
 *   paths; a moved floating ref recomputes, a pinned ref is reproducibly
 *   cacheable, and widening the glob at the same pin (more files, same SHA)
 *   recomputes too.
 * - **unpinned materialized** → a stat-digest of matched files; editing one
 *   recomputes.
 */
export async function freshnessTokenFromFacts(
  facts: FreshnessFacts,
): Promise<string> {
  if (facts.mode === 'pass-through') return '';
  if (facts.mode === 'disk-backed') {
    return digestGlobIndexManifest(
      await readGlobIndexManifest(facts.indexDir),
    );
  }
  if (facts.resolvedSha !== undefined) {
    return pinnedFreshnessToken(facts.resolvedSha, facts.files);
  }
  return digestFileStats(await snapshotIndexedFiles(facts.files));
}

/**
 * Whether a fact-set's token is invariant for the lifetime of a loaded
 * generation — i.e. it only changes when the source is reloaded, never on an
 * underlying edit between requests (ADR-0054, #415). A caller may memoize the
 * token per loaded generation **only** when this is true:
 * - **pass-through** → constant (empty); stable.
 * - **disk-backed** → the manifest only changes when the index is rebuilt, which
 *   reloads the generation; stable.
 * - **pinned materialized** → the resolved SHA + path set only change on reload;
 *   stable.
 * - **unpinned materialized** → a stat-digest of live files. An on-disk edit
 *   moves it with **no reload**, so memoizing it would serve stale content — the
 *   per-request stat *is* the content-aware invalidation. **Not** stable.
 */
export function freshnessFactsAreStable(facts: FreshnessFacts): boolean {
  if (facts.mode === 'materialized') return facts.resolvedSha !== undefined;
  return true;
}
