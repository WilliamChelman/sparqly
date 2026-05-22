import type { ParsedSource, SourceSpecObjectInput } from './source-spec';
import type { ParsedTransform } from './transform-spec';

/**
 * Glob storage-tier parsing helpers (ADR-0041). Kept in a dedicated module so
 * `source-spec.ts` stays focused on the parse dispatch, mirroring the shape of
 * `union-default-graph.ts` (ADR-0040).
 */

/**
 * Storage tier a glob source materializes into (ADR-0041). `memory` keeps the
 * fast in-heap `n3.Store`; `disk` materializes into an embedded quad store.
 */
export type StorageTier = 'memory' | 'disk';

/**
 * Picks the `storage` field off a glob source-spec input, validating it is one
 * of the known tiers. Returns an empty object when the field is omitted so the
 * spread leaves the parsed glob without the key (the `memory` default is
 * resolved later by {@link storageTier}).
 */
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

/**
 * Rejects `storage` on a non-glob source-spec input (ADR-0041). The storage
 * tier governs how a glob materializes its quads; an endpoint, view, or empty
 * source materializes nothing, so the field is meaningless there — and
 * silently ignoring it would mask a config mistake.
 */
export function rejectStorageOn(
  input: SourceSpecObjectInput,
  kind: 'endpoint' | 'view' | 'empty',
): void {
  if (input.storage !== undefined) {
    throw new Error(
      `\`storage\` is only valid on glob sources (got a ${kind} source)`,
    );
  }
}

/**
 * Rejects an `annotateSource` transform on a disk-backed glob (ADR-0041,
 * resolving its further-note 1). `annotateSource` projects an RDF-star
 * **Source record** — a quoted triple `<<s p o>>` as the annotation's
 * subject — and the embedded quad store backing a **Glob index** does not
 * persist quoted triples as terms: a built index would silently corrupt them.
 * `graphName` only rewrites the graph term and bakes cleanly, so it is
 * unaffected. The user keeps `annotateSource` by dropping to `storage: memory`.
 */
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

/**
 * Resolves the effective storage tier for any source (ADR-0041). A glob — and
 * a synthesized file child that inherited the field from its parent split-glob
 * meta — defaults to `memory` when the field is omitted; every other source
 * kind reports `memory`, as only a glob/file source materializes quads into a
 * store. This is the single defaulting point: read the effective value here,
 * never the raw `storage` field.
 */
export function storageTier(source: ParsedSource): StorageTier {
  if (source.kind === 'glob' || source.kind === 'file') {
    return source.storage ?? 'memory';
  }
  return 'memory';
}
