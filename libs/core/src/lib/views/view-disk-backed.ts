import { errAsync } from 'neverthrow';
import type { ResultAsync } from 'neverthrow';
import {
  type GlobIndexHandle,
  globIndexDir,
  openOrBuildGlobIndex,
} from '../glob-index';
import {
  diskBackedIndexIdentity,
  effectiveTransforms,
  type GlobLoadError,
  type ParsedGlobSource,
  type TransformParseError,
} from '../sources';

export type ResolveDiskBackedIndexHandleError =
  | TransformParseError
  | GlobLoadError;

const UNKNOWN_SPARQLY_VERSION = '0.0.0+unknown';

export interface OpenDiskBackedIndexHandleOptions {
  configDir: string;
  indexCacheDir?: string;
  sparqlyVersion?: string;
}

export function resolveDiskBackedIndexHandleResult(
  upstream: ParsedGlobSource,
  options: OpenDiskBackedIndexHandleOptions,
): ResultAsync<GlobIndexHandle, ResolveDiskBackedIndexHandleError> {
  const transformsResult = effectiveTransforms(upstream.transforms, undefined);
  if (transformsResult.isErr()) return errAsync(transformsResult.error);
  const { indexId, pattern } = diskBackedIndexIdentity(upstream);
  const indexDir = globIndexDir(options.configDir, indexId, options.indexCacheDir);
  return openOrBuildGlobIndex({
    glob: pattern,
    transforms: transformsResult.value,
    indexDir,
    sparqlyVersion: options.sparqlyVersion ?? UNKNOWN_SPARQLY_VERSION,
  });
}
