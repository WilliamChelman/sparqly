import { createHash } from 'node:crypto';
import { type ResultAsync } from 'neverthrow';
import { globIndexDir, openOrBuildGlobIndex } from '../glob-index';
import type { SourceError } from './errors';
import type { QuerySources } from './resolve-source';
import type { ResolveSourceResultOptions } from './resolve-source-result';
import type { ParsedFileSource, ParsedGlobSource } from './source-spec';
import type { ParsedTransform } from './transform-spec';

/** Manifest version token when a caller resolves a disk-backed glob without one. */
const UNKNOWN_SPARQLY_VERSION = '0.0.0+unknown';

/**
 * Resolves a `storage: disk` glob (ADR-0041): opens its Glob index under
 * `<configDir>/.sparqly/index/<source-id>/`, building it first if absent, and
 * returns a disk-backed {@link QuerySources} carrying the index as an RDF/JS
 * source. No Source record sidecar — the disk tier exists to escape exactly
 * that in-heap cost.
 */
export function resolveDiskBackedGlob(
  target: ParsedGlobSource,
  transforms: ReadonlyArray<ParsedTransform>,
  options: ResolveSourceResultOptions,
): ResultAsync<QuerySources, SourceError> {
  return resolveDiskBackedIndex(
    diskBackedIndexId(target),
    target.glob,
    transforms,
    options,
  );
}

/**
 * Resolves a `storage: disk` file child (ADR-0041): a synthesized split-glob
 * child that inherited `storage: disk` from its parent meta. It indexes under
 * its own id — `<parentId>/<glob-relative-path>` — so each sibling materializes
 * an independent Glob index, addressable without loading the file into RAM.
 */
export function resolveDiskBackedFile(
  target: ParsedFileSource,
  transforms: ReadonlyArray<ParsedTransform>,
  options: ResolveSourceResultOptions,
): ResultAsync<QuerySources, SourceError> {
  return resolveDiskBackedIndex(target.id, target.path, transforms, options);
}

/**
 * Shared Glob-index open/build for the disk tier: keys the index directory on
 * `indexId` and enumerates `pattern` (a glob for a meta, a single file path for
 * a split-glob child).
 */
function resolveDiskBackedIndex(
  indexId: string,
  pattern: string,
  transforms: ReadonlyArray<ParsedTransform>,
  options: ResolveSourceResultOptions,
): ResultAsync<QuerySources, SourceError> {
  const configDir = options.configDir ?? process.cwd();
  const indexDir = globIndexDir(configDir, indexId, options.indexCacheDir);
  return openOrBuildGlobIndex({
    glob: pattern,
    transforms,
    indexDir,
    sparqlyVersion: options.sparqlyVersion ?? UNKNOWN_SPARQLY_VERSION,
    // Carries the staleness `warn` to the boundary logger (ADR-0041): a stale
    // index is reused, but never silently.
    logger: options.logger,
  })
    .mapErr<SourceError>((e) => e)
    .map((handle) => ({
      mode: 'disk-backed' as const,
      source: handle.source,
      files: handle.files,
      indexDir,
      close: handle.close,
    }));
}

/** Stable index id for a disk-backed glob — its source id, or a glob hash. */
function diskBackedIndexId(target: ParsedGlobSource): string {
  if (target.id !== undefined) return target.id;
  // An un-named disk-backed glob still needs a stable index location; key it
  // on the glob pattern so re-runs reuse the same index directory.
  return createHash('sha256').update(target.glob).digest('hex').slice(0, 16);
}
