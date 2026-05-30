import {
  parseSourceAddress,
  resolveSourceResult,
  type ParsedSource,
  type QuerySources,
  type SourceError,
  type SourceRecordSidecar,
} from 'core';
import { type ResultAsync as ResultAsyncT } from 'neverthrow';
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
      .map(narrowLoadedSources);
  }
  return resolveSourceResult(target, { registry: resolutionRegistry }).map(
    narrowQuerySources,
  );
}

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

// The raw-pass-through pre-check in `diff.service.ts` blocks every target
// that could resolve into a `pass-through` or `disk-backed` mode here, so
// these branches stay defensive-only.
function narrowLoadedSources(sources: LoadedSources): LoadedLikeSources {
  if (sources.mode === 'disk-backed') {
    throw new Error(
      'loadSideSources: unexpected disk-backed mode after raw-target pre-check',
    );
  }
  // ADR-0050: `ensureSources` fresh-resolves worker-owned stores on main, so a
  // `materialized-remote` placeholder never reaches diff. Guard defensively.
  if (sources.mode === 'materialized-remote') {
    throw new Error(
      'loadSideSources: unexpected materialized-remote mode — store should resolve on main',
    );
  }
  return sources;
}

function narrowQuerySources(sources: QuerySources): LoadedLikeSources {
  if (sources.mode === 'disk-backed') {
    void sources.close();
    throw new Error(
      'loadSideSources: unexpected disk-backed mode after raw-target pre-check',
    );
  }
  if (sources.mode === 'pass-through') return sources;
  return {
    mode: 'materialized',
    store: sources.store,
    sourceRecords: sources.sourceRecords,
  };
}

export type LoadedLikeSources =
  | { mode: 'pass-through'; endpoint: { endpoint: string } }
  | { mode: 'materialized'; store: Store; sourceRecords?: SourceRecordSidecar };

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
  return false;
}
