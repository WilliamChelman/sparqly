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

export function resolveDiskBackedGlob(
  target: ParsedGlobSource,
  transforms: ReadonlyArray<ParsedTransform>,
  options: ResolveSourceResultOptions,
): ResultAsync<QuerySources, SourceError> {
  const { indexId, pattern } = diskBackedIndexIdentity(target);
  return resolveDiskBackedIndex(indexId, pattern, transforms, options);
}

export function resolveDiskBackedFile(
  target: ParsedFileSource,
  transforms: ReadonlyArray<ParsedTransform>,
  options: ResolveSourceResultOptions,
): ResultAsync<QuerySources, SourceError> {
  const { indexId, pattern } = diskBackedIndexIdentity(target);
  return resolveDiskBackedIndex(indexId, pattern, transforms, options);
}

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
    // Stale indexes are reused but warned through this logger — never silently.
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

// `indexId` keys the index directory; `pattern` is a glob (meta) or single
// file path (child). Shared with `sparqly index` so ahead-of-time builds
// land where query/serve reads.
export function diskBackedIndexIdentity(
  source: ParsedGlobSource | ParsedFileSource,
): { indexId: string; pattern: string } {
  if (source.kind === 'file') {
    return { indexId: source.id, pattern: source.path };
  }
  return { indexId: diskBackedIndexId(source), pattern: source.glob };
}

/** Stable index id for a disk-backed glob — its source id, or a glob hash. */
function diskBackedIndexId(target: ParsedGlobSource): string {
  if (target.id !== undefined) return target.id;
  // An un-named disk-backed glob still needs a stable index location; key it
  // on the glob pattern so re-runs reuse the same index directory.
  return createHash('sha256').update(target.glob).digest('hex').slice(0, 16);
}
