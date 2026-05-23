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

/**
 * Split a wire-format source ref into a bare registry id plus an optional
 * address-form `:ref` pin (ADR-0029). Tolerant of inputs without the leading
 * `@` (the controller historically accepted both).
 */
export function parsePinnedInput(raw: string): { id: string; pin?: string } {
  if (!raw.startsWith('@')) return { id: raw };
  const parsed = parseSourceAddress(raw);
  if (parsed.isErr()) return { id: raw.slice(1) };
  return { id: parsed.value.id, pin: parsed.value.ref };
}

/**
 * Apply an address-form `:ref` pin to the resolved target. Globs receive
 * `gitRef`; views receive `fromGitRef` so the resolver walks the `from:` chain
 * down to the leaf glob (ADR-0029). Split-glob file children (`kind: 'file'`)
 * are re-synthesized as a one-file pinned glob so `pinAndLoadGlob` resolves
 * SHA + repoRoot at load time — the engine map only warmed the working-tree
 * variant. Other target kinds pass through unchanged.
 */
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

/**
 * The diff endpoint's engine map is warmed against each declared source's
 * `gitRef` (or working tree) at bootstrap. When a request supplies an
 * address-form `:ref` pin that overrides what was warmed, the cached engine
 * holds the wrong content — so the side resolves directly via
 * `resolveSourceResult`, paying a fresh load but honoring the per-call pin
 * (ADR-0029). Sides without an override stay on the warm cache.
 */
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

/**
 * `diff` cannot run against a disk-backed glob (ADR-0041): RDFC-1.0
 * canonicalization needs every quad in memory — the very cost `storage: disk`
 * exists to escape. A `503`-style "still building" outcome is no different
 * here; either way diff rejects the side with a clear `glob-load` error.
 */
function indexingToSourceError(
  error: SourceError | IndexingError,
): SourceError {
  if (isIndexingError(error)) {
    return {
      kind: 'glob-load',
      glob: [],
      message: `diff cannot run while disk-backed glob '${error.source}' is still building its index (ADR-0041)`,
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
        'diff does not support disk-backed glob sources (`storage: disk`); RDFC-1.0 canonicalization cannot scale to a disk-backed glob (ADR-0041)',
    });
  }
  return ok(sources);
}

export type LoadedLikeSources =
  | { mode: 'pass-through'; endpoint: { endpoint: string } }
  | { mode: 'materialized'; store: Store; sourceRecords?: SourceRecordSidecar };

/**
 * Symmetric counterpart to {@link rejectDiskBackedSources} for the pin-override
 * path: takes a freshly-resolved {@link QuerySources} and returns a typed
 * `SourceError` for the `disk-backed` mode (releasing the LevelDB lock on the
 * way out) instead of throwing inside a neverthrow callback. RDFC-1.0
 * canonicalization cannot scale to a disk-backed glob (ADR-0041 amends
 * ADR-0032).
 */
export function rejectDiskBackedQuerySources(
  sources: QuerySources,
): Result<LoadedLikeSources, SourceError> {
  if (sources.mode === 'disk-backed') {
    void sources.close();
    return err({
      kind: 'glob-load',
      glob: [],
      message:
        'diff does not support disk-backed glob sources (`storage: disk`); RDFC-1.0 canonicalization cannot scale to a disk-backed glob (ADR-0041)',
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
  // applyAddressPin re-synthesizes a `kind: 'file'` declared child as a
  // `kind: 'glob'` target — that kind shift is itself the override signal.
  if (target.kind !== declared.kind) return true;
  if (target.kind === 'glob' && declared.kind === 'glob') {
    return target.gitRef !== declared.gitRef;
  }
  if (target.kind === 'view' && declared.kind === 'view') {
    return target.fromGitRef !== declared.fromGitRef;
  }
  return false;
}
