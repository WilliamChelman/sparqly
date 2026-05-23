import type {
  ParsedEndpointSource,
  ParsedSource,
  QueryEngine,
  SourceError,
  SourceRecordSidecar,
} from 'core';
import type { SourceRowError } from '../sources/source-row-projector';
import type * as RDF from '@rdfjs/types';
import type { Store } from 'n3';
import type { Result } from 'neverthrow';
import type { StoreRef } from './tokens';

export type LoadedSources =
  | { mode: 'materialized'; store: Store; sourceRecords?: SourceRecordSidecar }
  | { mode: 'pass-through'; endpoint: ParsedEndpointSource }
  | {
      /** A `storage: disk` glob served from its on-disk Glob index — no sidecar. */
      mode: 'disk-backed';
      source: RDF.Source;
      indexDir: string;
    };

/** Transient "retry shortly" — travels the `Result` error channel so the HTTP
 * boundary maps it to a 503 like any other source outcome. */
export interface IndexingError {
  kind: 'indexing';
  source: string;
  message: string;
}

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

/** Default when no spawn is provided — fail loudly rather than never index. */
export function spawnIndexBuildUnavailable(): never {
  throw new Error(
    'EngineMap: a disk-backed source needs an index build, but no ' +
      'spawnIndexBuild was provided to EngineMap.create (ADR-0042)',
  );
}

export interface LoadedEntry {
  engine: QueryEngine;
  storeRef: StoreRef | undefined;
  sources: LoadedSources;
}

export interface Entry {
  source: ParsedSource;
  files: string[];
  loadedAt: number | undefined;
  loadMs: number | undefined;
  loaded: Promise<Result<LoadedEntry, SourceError>> | undefined;
  disk: Promise<Result<LoadedEntry, SourceError | IndexingError>> | undefined;
  closeIndex: (() => Promise<void>) | undefined;
  current: LoadedEntry | undefined;
  /** De-dups `stale-detected` SSE emissions — reset when leaving `stale`. */
  staleReasonSeen: string | undefined;
  /**
   * Inline failure surface for the Sources page row. For in-memory entries
   * this is observational (the load slot still clears on err for self-heal).
   * For disk-backed entries it is *sticky*: while set, `ensureDiskBacked`
   * skips re-spawning a build — only Retry clears it.
   */
  lastError: SourceRowError | undefined;
}
