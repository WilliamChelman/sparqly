import { ResultAsync, errAsync, ok, okAsync, type Result } from 'neverthrow';
import { Store } from 'n3';
import { loadRdfResult, type GraphMode, type LoadResult } from '../engine';
import { resolveViewResult, type ResolveViewOptions } from '../views';
import type { SourceError, TransformParseError } from './errors';
import { parseGraphNameTransformResult } from './graph-name-transform';
import type { QuerySources } from './resolve-source';
import type {
  ParsedFileSource,
  ParsedGlobSource,
  ParsedSource,
  ParsedViewSource,
} from './source-spec';
import { applyTransformPipeline } from './transform-pipeline';
import type { ParsedTransform } from './transform-spec';

export {
  formatSourceError,
  type EndpointFetchError,
  type GlobLoadError,
  type QueryExecutionError,
  type ReferenceTargetError,
  type SourceError,
  type TransformParseError,
} from './errors';

export interface ResolveSourceResultOptions {
  graphMode?: GraphMode;
  registry?: ReadonlyArray<ParsedSource>;
  cacheDir?: ResolveViewOptions['cacheDir'];
  now?: ResolveViewOptions['now'];
  engine?: ResolveViewOptions['engine'];
  logger?: ResolveViewOptions['logger'];
}

/**
 * Primary `Result`-typed implementation of source resolution. Returns the
 * same payload as the legacy `resolveSource` for ok paths, and a tagged
 * `SourceError` for failure paths. The legacy `resolveSource` is a thin
 * throw-wrapping adapter around this function (ADR-0024).
 */
export function resolveSourceResult(
  target: ParsedSource,
  options: ResolveSourceResultOptions = {},
): ResultAsync<QuerySources, SourceError> {
  if (target.kind === 'reference') {
    return errAsync({ kind: 'reference-target' });
  }
  if (target.kind === 'endpoint') {
    return okAsync({ mode: 'pass-through', endpoint: target });
  }
  if (target.kind === 'empty') {
    return okAsync(materialized(new Store(), [], {}));
  }
  if (target.kind === 'glob') {
    const transformsResult = effectiveTransforms(target, options.graphMode);
    if (transformsResult.isErr()) return errAsync(transformsResult.error);
    const transforms = transformsResult.value;
    return loadGlobIntoStore(target, transforms, options).map((loaded) =>
      materialized(loaded.store, loaded.files, loaded.prefixes),
    );
  }
  if (target.kind === 'file') {
    return loadFileIntoStore(target, target.transforms ?? [], options).map(
      (loaded) =>
        materialized(loaded.store, loaded.files, loaded.prefixes),
    );
  }
  return resolveViewTargetResult(target, options);
}

function resolveViewTargetResult(
  view: ParsedViewSource,
  options: ResolveSourceResultOptions,
): ResultAsync<QuerySources, SourceError> {
  const registry = options.registry ?? [view];
  return resolveViewResult({
    view,
    registry,
    cacheDir: options.cacheDir,
    now: options.now,
    engine: options.engine,
    logger: options.logger,
  }).map((store) => materialized(store, [], {}));
}

function loadGlobIntoStore(
  source: ParsedGlobSource,
  transforms: ReadonlyArray<ParsedTransform>,
  options: ResolveSourceResultOptions,
): ResultAsync<LoadResult, SourceError> {
  return loadRdfResult({ sources: source.glob, logger: options.logger }).map((sub) => {
    const transformed = applyTransformPipeline(sub.store, transforms, {
      perFileRecords: sub.perFileRecords,
    });
    return {
      store: transformed,
      files: [...sub.files],
      prefixes: { ...sub.prefixes },
      perFileRecords: sub.perFileRecords,
    };
  });
}

function loadFileIntoStore(
  source: ParsedFileSource,
  transforms: ReadonlyArray<ParsedTransform>,
  options: ResolveSourceResultOptions,
): ResultAsync<LoadResult, SourceError> {
  // A synthesized file child resolves like a one-file glob — same loader,
  // same transform pipeline (ADR-0027).
  return loadRdfResult({ sources: source.path, logger: options.logger }).map(
    (sub) => {
      const transformed = applyTransformPipeline(sub.store, transforms, {
        perFileRecords: sub.perFileRecords,
      });
      return {
        store: transformed,
        files: [...sub.files],
        prefixes: { ...sub.prefixes },
        perFileRecords: sub.perFileRecords,
      };
    },
  );
}

function effectiveTransforms(
  source: ParsedGlobSource,
  defaultGraphMode: GraphMode | undefined,
): Result<ReadonlyArray<ParsedTransform>, TransformParseError> {
  if (source.transforms !== undefined) return ok(source.transforms);
  if (defaultGraphMode === undefined || defaultGraphMode === 'preserve') {
    return ok([]);
  }
  return parseGraphNameTransformResult(defaultGraphMode).map((apply) => [
    { key: 'graphName', apply },
  ]);
}

function materialized(
  store: Store,
  files: string[],
  prefixes: Record<string, Record<string, string>>,
): QuerySources {
  return { mode: 'materialized', store, files, prefixes };
}
