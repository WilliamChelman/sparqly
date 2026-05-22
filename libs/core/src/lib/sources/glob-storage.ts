import type { ParsedSource, SourceSpecObjectInput } from './source-spec';

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
 * Resolves the effective storage tier for any source (ADR-0041). A glob
 * defaults to `memory` when the field is omitted; every other source kind
 * reports `memory` — only a glob materializes quads into a store, so no other
 * source kind has a disk tier. This is the single defaulting point: read the
 * effective value here, never the raw `storage` field.
 */
export function storageTier(source: ParsedSource): StorageTier {
  if (source.kind === 'glob') {
    return source.storage ?? 'memory';
  }
  return 'memory';
}
