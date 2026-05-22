import {
  storageTier,
  type ParsedFileSource,
  type ParsedGlobSource,
  type ParsedSource,
} from 'core';

/**
 * A disk-backed source the `sparqly index` command can build (#346): a
 * `storage: disk` glob, or a split-glob file child that inherited the tier.
 */
export type IndexTarget = ParsedGlobSource | ParsedFileSource;

/**
 * Resolves the disk-backed sources `sparqly index` should build from the
 * expanded registry. With no `ids`, every disk-backed source is selected and
 * non-disk-backed entries are silently skipped.
 */
export function selectIndexTargets(
  registry: ReadonlyArray<ParsedSource>,
  ids: ReadonlyArray<string>,
): ReadonlyArray<IndexTarget> {
  if (ids.length === 0) {
    return registry.filter(isDiskBacked);
  }
  return ids.map((id) => selectById(registry, id));
}

/** Resolves one `@id` (or bare id) arg to its disk-backed registry source. */
function selectById(
  registry: ReadonlyArray<ParsedSource>,
  rawId: string,
): IndexTarget {
  const id = rawId.startsWith('@') ? rawId.slice(1) : rawId;
  const source = registry.find((entry) => entry.id === id);
  if (source === undefined) {
    throw new Error(`unknown source @${id}`);
  }
  if (!isDiskBacked(source)) {
    throw new Error(
      `@${id} is not a disk-backed source (storage: disk) — ` +
        `only disk-backed globs have a Glob index to build`,
    );
  }
  return source;
}

/** Whether a source materializes into a Glob index (`storage: disk`). */
function isDiskBacked(source: ParsedSource): source is IndexTarget {
  return (
    (source.kind === 'glob' || source.kind === 'file') &&
    storageTier(source) === 'disk'
  );
}
