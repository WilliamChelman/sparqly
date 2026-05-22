import type * as RDF from '@rdfjs/types';
import type { Store } from 'n3';
import type { GraphMode } from '../engine';
import type { ParsedEndpointSource, ParsedSource } from './source-spec';
import type { ResolveViewOptions } from '../views';
import {
  formatSourceError,
  resolveSourceResult,
  type ResolveSourceResultOptions,
} from './resolve-source-result';
import type { SourceRecordSidecar } from './source-record-sidecar';

export type QuerySources =
  | { mode: 'pass-through'; endpoint: ParsedEndpointSource }
  | {
      mode: 'materialized';
      store: Store;
      files: string[];
      prefixes: Record<string, Record<string, string>>;
      /**
       * Loader-attached source-record sidecar (ADR-0032). Populated for
       * glob/file targets (working tree and pinned); absent for view,
       * empty, and endpoint resolutions. The map's keys are
       * graph-agnostic triple-pattern strings; re-key by canonical N-Quads
       * at diff time via the canonicalizer's blank-node label map.
       */
      sourceRecords?: SourceRecordSidecar;
    }
  | {
      /**
       * A `storage: disk` glob materialized into a Glob index (ADR-0041). The
       * quads live in an embedded on-disk quad store, not the V8 heap, so a
       * glob whose triples exceed RAM stays queryable.
       */
      mode: 'disk-backed';
      /**
       * The opened Glob index as an RDF/JS source. Flows into the query
       * engine through the same `sources: [...]` context an in-memory glob
       * uses — a disk-backed glob answers SPARQL identically.
       */
      source: RDF.Source;
      /** Absolute paths of the files baked into the index. */
      files: string[];
      /** Directory the Glob index lives under. */
      indexDir: string;
      /**
       * Releases the embedded LevelDB lock; must be called once querying is
       * done. A disk-backed glob carries no Source record sidecar — an in-heap
       * record per quad is precisely the cost the disk tier exists to escape
       * (ADR-0041 amends ADR-0032).
       */
      close(): Promise<void>;
    };

export interface ResolveSourceOptions {
  /**
   * Default `graphName` mode applied when a glob target has no `transforms`
   * declared. Synthesizes `[{ graphName: <mode> }]` for the target. Sources
   * that already declare `transforms` are passed through unchanged. Reserved
   * for programmatic callers — the CLI no longer exposes a top-level flag for
   * this; graph-name semantics belong on a glob source's `transforms` (#135).
   */
  graphMode?: GraphMode;
  /**
   * Registry of sibling source-specs. Required when the target is a view, so
   * its `from:` chain can be walked. Untargeted entries are never opened.
   */
  registry?: ReadonlyArray<ParsedSource>;
  /** Forwarded to view resolution when the target is (or descends to) a view. */
  cacheDir?: ResolveViewOptions['cacheDir'];
  /** Forwarded to view resolution. */
  now?: ResolveViewOptions['now'];
  /** Forwarded to view resolution. */
  engine?: ResolveViewOptions['engine'];
  /** Forwarded to view resolution so view-chain SPARQL runs emit `query` events. */
  logger?: ResolveViewOptions['logger'];
}

/**
 * @deprecated Use `resolveSourceResult` (ADR-0024). This is a thin throw-wrapping
 * adapter that delegates to it; it exists only so non-converted callers
 * (`describe`, `bootstrap`, `engine-map`, ...) keep compiling until they
 * migrate. The adapter is deleted when the last `@deprecated` import is gone.
 */
export async function resolveSource(
  target: ParsedSource,
  options: ResolveSourceOptions = {},
): Promise<QuerySources> {
  const result = await resolveSourceResult(
    target,
    options as ResolveSourceResultOptions,
  );
  if (result.isErr()) throw new Error(formatSourceError(result.error));
  return result.value;
}
