import { createHash } from 'node:crypto';
import { type ResultAsync } from 'neverthrow';
import { globIndexDir, openOrBuildGlobIndex } from '../glob-index';
import type { SourceError } from './errors';
import type { QuerySources } from './resolve-source';
import type { ResolveSourceResultOptions } from './resolve-source-result';
import type { ParsedGlobSource } from './source-spec';
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
  const configDir = options.configDir ?? process.cwd();
  const indexDir = globIndexDir(configDir, diskBackedIndexId(target));
  return openOrBuildGlobIndex({
    glob: target.glob,
    transforms,
    indexDir,
    sparqlyVersion: options.sparqlyVersion ?? UNKNOWN_SPARQLY_VERSION,
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
