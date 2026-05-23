import type {
  ParsedEndpointSource,
  ParsedSource,
  QueryEngine,
  SourceError,
  SourceRecordSidecar,
} from 'core';
import type * as RDF from '@rdfjs/types';
import type { Store } from 'n3';
import type { Result } from 'neverthrow';
import type { StoreRef } from './tokens';

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

/**
 * Default `SpawnIndexBuild` used when `EngineMapOptions.spawnIndexBuild` is
 * omitted — touching a not-yet-built disk-backed source then fails loudly
 * rather than silently never indexing. `serve` always injects a real spawn.
 */
export function spawnIndexBuildUnavailable(): never {
  throw new Error(
    'EngineMap: a disk-backed source needs an index build, but no ' +
      'spawnIndexBuild was provided to EngineMap.create (ADR-0042)',
  );
}

/**
 * Settled-`ok` view of a successful entry load — the engine, its store ref
 * (when materialized), and the `LoadedSources` projection consumers see.
 * Lives here so peer modules (`engine-map-actions.ts`) can manipulate it
 * without a circular import back into `engine-map.ts`.
 */
export interface LoadedEntry {
  engine: QueryEngine;
  storeRef: StoreRef | undefined;
  sources: LoadedSources;
}

/**
 * Per-source bookkeeping held inside {@link EngineMap}. Exported so the
 * peer action helpers (`reloadEntry`, `unloadEntry` — see
 * `engine-map-actions.ts`) can read and mutate the same record the class
 * stores in its internal `Map<id, Entry>`. Field-by-field comments live in
 * the class file where the lifecycle is wired.
 */
export interface Entry {
  source: ParsedSource;
  files: string[];
  loadedAt: number | undefined;
  loadMs: number | undefined;
  loaded: Promise<Result<LoadedEntry, SourceError>> | undefined;
  disk: Promise<Result<LoadedEntry, SourceError | IndexingError>> | undefined;
  closeIndex: (() => Promise<void>) | undefined;
  current: LoadedEntry | undefined;
}
