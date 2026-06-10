import {
  QueryEngine,
  type GitPort,
  type ParsedEndpointSource,
  type ParsedSource,
  type QueryExecutor,
  type RepoDiscoveryDeps,
  type SourceError,
  type SourceRecordSidecar,
} from 'core';
import type { SparqlyLogger } from 'common';
import type { SourceRowError } from '../sources/source-row-projector';
import type * as RDF from '@rdfjs/types';
import type { Store } from 'n3';
import { ok, type Result } from 'neverthrow';
import type { StoreRef } from './tokens';
import type { SpawnIndexBuild } from './index-build-pool';
import type { QueryWorkerPool } from '../sparql/query-worker-pool';
import type { SourceStateEmitter } from '../sources/source-state-emitter';

/** Construction options for an {@link EngineMap}. */
export interface EngineMapOptions {
  logger?: SparqlyLogger;
  configDir?: string;
  sparqlyVersion?: string;
  indexCacheDir?: string;
  // Query cache (ADR-0054) byte budget, forwarded to the store on open.
  queryCacheBudget?: { maxBytes?: number | null; maxEntryBytes?: number };
  // Spawns the isolated `sparqly index` child; omitting it makes the first
  // touch of a not-yet-built disk-backed source throw.
  spawnIndexBuild?: SpawnIndexBuild;
  indexConcurrency?: number;
  indexBuildCooldownMs?: number;
  now?: () => number;
  sourceStateEmitter?: SourceStateEmitter;
  // When set, in-memory materialized queries run off the main loop in this
  // worker pool (ADR-0050). Omitting it keeps the legacy main-thread path.
  queryPool?: QueryWorkerPool;
  // Resolves an ad-hoc pin's `gitRef:` to a SHA on the main thread (the worker
  // routing key, #390). Injected so tests stub git; production builds the CLI port.
  gitPort?: GitPort;
  repoDiscovery?: RepoDiscoveryDeps;
}

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

/** A freshly-registered entry whose store hasn't been resolved yet — every
 * field empty until first touch lazily loads it. */
export function unloadedEntry(source: ParsedSource): Entry {
  return {
    source,
    files: [],
    loadedAt: undefined,
    loadMs: undefined,
    quads: undefined,
    loaded: undefined,
    disk: undefined,
    closeIndex: undefined,
    current: undefined,
    staleReasonSeen: undefined,
    lastError: undefined,
    loadEpoch: 0,
  };
}

/** An endpoint entry: pre-loaded at construction, every query a pass-through to
 * the remote SPARQL service (no lazy load, no store on the heap). */
export function endpointEntry(
  src: ParsedEndpointSource,
  logger: SparqlyLogger | undefined,
): Entry {
  const loaded: LoadedEntry = {
    engine: new QueryEngine(src, {
      id: src.id ?? src.endpoint,
      mode: 'pass-through',
      logger,
    }),
    storeRef: undefined,
    sources: { mode: 'pass-through', endpoint: src },
  };
  return {
    ...unloadedEntry(src),
    loaded: Promise.resolve(ok(loaded)),
    current: loaded,
  };
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
  // Bumped by every Unload (ADR-0050). A worker load captures it before its
  // round-trip and discards its result if the epoch advanced meanwhile, so a
  // reload that completes *after* an Unload can't resurrect the cleared entry.
  loadEpoch: number;
}
