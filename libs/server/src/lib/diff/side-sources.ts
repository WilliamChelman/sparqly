import {
  parseSourceAddress,
  resolveSourceResult,
  type ParsedSource,
  type QuerySources,
  type SourceError,
  type SourceRecordSidecar,
} from 'core';
import {
  err,
  ok,
  type Result,
  type ResultAsync as ResultAsyncT,
} from 'neverthrow';
import type { Store } from 'n3';
import {
  isIndexingError,
  type EngineMap,
  type IndexingError,
  type LoadedSources,
} from '../bootstrap';

/** Tolerant of inputs without the leading `@`. */
export function parsePinnedInput(raw: string): { id: string; pin?: string } {
  if (!raw.startsWith('@')) return { id: raw };
  const parsed = parseSourceAddress(raw);
  if (parsed.isErr()) return { id: raw.slice(1) };
  return { id: parsed.value.id, pin: parsed.value.ref };
}

/** Split-glob `file` children get re-synthesized as a one-file pinned glob. */
export function applyAddressPin(
  entry: ParsedSource,
  ref: string,
): ParsedSource {
  if (entry.kind === 'glob') return { ...entry, gitRef: ref };
  if (entry.kind === 'view') return { ...entry, fromGitRef: ref };
  if (entry.kind === 'file') {
    return {
      kind: 'glob',
      id: entry.id,
      glob: entry.path,
      gitRef: ref,
      transforms: entry.transforms,
    };
  }
  return entry;
}

/** Sides with a runtime pin override bypass the warm cache and resolve fresh. */
export function loadSideSources(
  engineMap: EngineMap,
  resolutionRegistry: ReadonlyArray<ParsedSource>,
  target: ParsedSource,
): ResultAsyncT<LoadedLikeSources, SourceError> {
  if (target.id !== undefined && !hasRuntimePinOverride(engineMap, target)) {
    return engineMap
      .ensureSources(target.id)
      .mapErr(indexingToSourceError)
      .andThen(rejectDiskBackedSources);
  }
  return resolveSourceResult(target, { registry: resolutionRegistry }).andThen(
    rejectDiskBackedQuerySources,
  );
}

/** diff cannot run against a disk-backed glob — RDFC-1.0 needs every quad in memory. */
function indexingToSourceError(
  error: SourceError | IndexingError,
): SourceError {
  if (isIndexingError(error)) {
    return {
      kind: 'glob-load',
      glob: [],
      message: `diff cannot run while disk-backed glob '${error.source}' is still building its index`,
    };
  }
  return error;
}

function rejectDiskBackedSources(
  sources: LoadedSources,
): Result<LoadedLikeSources, SourceError> {
  if (sources.mode === 'disk-backed') {
    return err({
      kind: 'glob-load',
      glob: [],
      message:
        'diff does not support disk-backed glob sources (`storage: disk`); RDFC-1.0 canonicalization cannot scale to a disk-backed glob',
    });
  }
  return ok(sources);
}

export type LoadedLikeSources =
  | { mode: 'pass-through'; endpoint: { endpoint: string } }
  | { mode: 'materialized'; store: Store; sourceRecords?: SourceRecordSidecar };

/** Releases the LevelDB lock before erroring. */
export function rejectDiskBackedQuerySources(
  sources: QuerySources,
): Result<LoadedLikeSources, SourceError> {
  if (sources.mode === 'disk-backed') {
    void sources.close();
    return err({
      kind: 'glob-load',
      glob: [],
      message:
        'diff does not support disk-backed glob sources (`storage: disk`); RDFC-1.0 canonicalization cannot scale to a disk-backed glob',
    });
  }
  if (sources.mode === 'pass-through') return ok(sources);
  return ok({
    mode: 'materialized',
    store: sources.store,
    sourceRecords: sources.sourceRecords,
  });
}

function hasRuntimePinOverride(
  engineMap: EngineMap,
  target: ParsedSource,
): boolean {
  if (target.id === undefined) return false;
  const declared = engineMap.getSource(target.id);
  if (!declared) return false;
  // applyAddressPin re-synthesizes `file` children as `glob` — kind shift is the override signal.
  if (target.kind !== declared.kind) return true;
  if (target.kind === 'glob' && declared.kind === 'glob') {
    return target.gitRef !== declared.gitRef;
  }
  if (target.kind === 'view' && declared.kind === 'view') {
    return target.fromGitRef !== declared.fromGitRef;
  }
  return false;
}
