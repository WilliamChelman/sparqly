import type {
  ParsedEndpointSource,
  ParsedSource,
  QueryExecutor,
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
  // ADR-0050: the materialized store lives in the query worker, not the main
  // heap. Callers needing the store on main (diff) resolve it fresh instead.
  | { mode: 'materialized-remote' }
  | { mode: 'pass-through'; endpoint: ParsedEndpointSource }
  | {
      mode: 'disk-backed';
      source: RDF.Source;
      indexDir: string;
    };

// Transient "retry shortly" — surfaced via the Result error channel so the HTTP
// boundary maps it to a 503 like any other source outcome.
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

// Default when no spawn is provided — fail loudly rather than never index.
export function spawnIndexBuildUnavailable(): never {
  throw new Error(
    'EngineMap: a disk-backed source needs an index build, but no ' +
      'spawnIndexBuild was provided to EngineMap.create',
  );
}

export interface LoadedEntry {
  engine: QueryExecutor;
  storeRef: StoreRef | undefined;
  sources: LoadedSources;
}

export interface Entry {
  source: ParsedSource;
  files: string[];
  loadedAt: number | undefined;
  loadMs: number | undefined;
  // Worker-owned store's quad count, mirrored on load-success (ADR-0050). For
  // main-heap stores the count comes from `current.storeRef` instead.
  quads: number | undefined;
  loaded: Promise<Result<LoadedEntry, SourceError>> | undefined;
  disk: Promise<Result<LoadedEntry, SourceError | IndexingError>> | undefined;
  closeIndex: (() => Promise<void>) | undefined;
  current: LoadedEntry | undefined;
  // De-dups `stale-detected` SSE emissions — reset when leaving `stale`.
  staleReasonSeen: string | undefined;
  // Sticky for disk-backed entries: while set, `ensureDiskBacked` skips
  // re-spawning a build — only Retry clears it. Observational for in-memory.
  lastError: SourceRowError | undefined;
}
