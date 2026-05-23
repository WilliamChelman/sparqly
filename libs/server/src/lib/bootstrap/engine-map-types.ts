import type {
  ParsedEndpointSource,
  SourceRecordSidecar,
} from 'core';
import type * as RDF from '@rdfjs/types';
import type { Store } from 'n3';

/**
 * Loaded view of a served source, surfaced to consumers that need the
 * underlying Store and (where available) the loader-attached source-record
 * sidecar (ADR-0032). Discriminated mirrors `QuerySources` so callers can
 * dispatch on `mode` without reaching into `engine-map` internals.
 */
export type LoadedSources =
  | { mode: 'materialized'; store: Store; sourceRecords?: SourceRecordSidecar }
  | { mode: 'pass-through'; endpoint: ParsedEndpointSource }
  | {
      /**
       * A `storage: disk` glob hosted by `serve` from its on-disk Glob index
       * (ADR-0041). The quads live in an embedded quad store, not the V8 heap,
       * and carry no Source record sidecar — `diff` rejects this mode.
       */
      mode: 'disk-backed';
      source: RDF.Source;
      indexDir: string;
    };

/**
 * Returned by {@link EngineMap.ensure}/{@link EngineMap.ensureSources} when a
 * disk-backed glob's Glob index is still building in the background (ADR-0041,
 * #340). It is not a load *failure* — it is a transient "retry shortly" state
 * — but it travels the same `Result` error channel so the `serve` HTTP
 * boundary can route it to a `503` the way every other source outcome routes
 * through an error-to-status mapper.
 */
export interface IndexingError {
  kind: 'indexing';
  /** Source `@id` whose Glob index is still building. */
  source: string;
  message: string;
}

/**
 * Type guard separating an {@link IndexingError} from any other tagged error
 * travelling the `Result` channel (a core `SourceError`, a `TargetError`). The
 * parameter is the structural `{ kind }` shape every such error carries so the
 * `serve` boundary can call this on its widest error union.
 */
export function isIndexingError(
  error: { kind: string },
): error is IndexingError {
  return error.kind === 'indexing';
}

export function indexingError(source: string): IndexingError {
  return {
    kind: 'indexing',
    source,
    message: `disk-backed glob '${source}' is building its index — retry shortly`,
  };
}
