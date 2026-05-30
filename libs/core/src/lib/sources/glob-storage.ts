import type { ParsedSource, SourceSpecObjectInput } from './source-spec';
import type { ParsedTransform } from './transform-spec';

// `memory` keeps the fast in-heap `n3.Store`; `disk` materializes into an
// embedded quad store.
export type StorageTier = 'memory' | 'disk';

// Returns `{}` for omitted so the spread leaves the parsed glob without the
// key — the `memory` default is resolved later by {@link storageTier}.
export function pickStorage(
  input: SourceSpecObjectInput,
): { storage?: StorageTier } {
  if (input.storage === undefined) return {};
  if (input.storage !== 'memory' && input.storage !== 'disk') {
    throw new Error(
      `\`storage\` must be 'memory' or 'disk' (got ${JSON.stringify(input.storage)})`,
    );
  }
  return { storage: input.storage };
}

export function rejectStorageOn(
  input: SourceSpecObjectInput,
  kind: 'endpoint' | 'empty',
): void {
  if (input.storage !== undefined) {
    throw new Error(
      `\`storage\` is only valid on glob sources (got a ${kind} source)`,
    );
  }
}

// `annotateSource` projects an RDF-star quoted triple as the annotation's
// subject; the embedded quad store can't persist quoted triples as terms, so
// a built index would silently corrupt them. `graphName` rewrites only the
// graph term and is unaffected.
export function rejectAnnotateSourceOnDiskGlob(
  storage: StorageTier | undefined,
  transforms: ReadonlyArray<ParsedTransform> | undefined,
): void {
  if (storage !== 'disk' || transforms === undefined) return;
  if (transforms.some((transform) => transform.key === 'annotateSource')) {
    throw new Error(
      '`annotateSource` is not supported on a disk-backed glob (`storage: disk`): ' +
        'the embedded quad store cannot persist RDF-star quoted triples. ' +
        'Drop the transform or use `storage: memory`.',
    );
  }
}

// Single defaulting point — callers read the effective value here, never the
// raw `storage` field.
export function storageTier(source: ParsedSource): StorageTier {
  if (source.kind === 'glob' || source.kind === 'file') {
    return source.storage ?? 'memory';
  }
  return 'memory';
}
