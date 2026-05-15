import * as nodePath from 'node:path';
import { ResultAsync, errAsync, ok, okAsync, type Result } from 'neverthrow';
import { Store } from 'n3';
import {
  loadRdfResult,
  parseRdfFileResult,
  type GraphMode,
  type LoadResult,
} from '../engine';
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
import { GitCliPort } from './git/git-cli-port';
import type { GitPort } from './git/git-port';
import type { RepoDiscoveryDeps } from './git/discover-repo';
import {
  defaultRepoDiscovery,
  pinGlobSource,
  PinnedFileMissingError,
} from './git/pin-glob-source';
import { normalizeRegistryPinsResult } from './git/normalize-registry-pins';

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
  /**
   * Absolute path to the project config directory (or cwd when no config is
   * loaded). Used as the resolution root for `gitRoot:` relative overrides on
   * pinned glob sources (ADR-0029). Defaults to `process.cwd()`.
   */
  configDir?: string;
  /**
   * Injectable git port for pinned-source loading (ADR-0029). Defaults to the
   * production `GitCliPort` (shells out to `git`).
   */
  gitPort?: GitPort;
  /**
   * Injectable repo-discovery deps for pinned-source loading (ADR-0029).
   * Defaults to a filesystem-backed implementation.
   */
  repoDiscovery?: RepoDiscoveryDeps;
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
  return normalizeRegistryPinsResult(registry, {
    configDir: options.configDir ?? process.cwd(),
    port: options.gitPort ?? new GitCliPort(),
    repoDiscovery: options.repoDiscovery ?? defaultRepoDiscovery,
    logger: options.logger,
  })
    .mapErr<SourceError>((e) => e)
    .andThen<QuerySources, SourceError>((normalizedRegistry) =>
      resolveViewResult({
        view,
        registry: normalizedRegistry,
        cacheDir: options.cacheDir,
        now: options.now,
        engine: options.engine,
        logger: options.logger,
        configDir: options.configDir ?? process.cwd(),
        gitPort: options.gitPort ?? new GitCliPort(),
        repoDiscovery: options.repoDiscovery ?? defaultRepoDiscovery,
      }).map((store) => materialized(store, [], {})),
    );
}

function loadGlobIntoStore(
  source: ParsedGlobSource,
  transforms: ReadonlyArray<ParsedTransform>,
  options: ResolveSourceResultOptions,
): ResultAsync<LoadResult, SourceError> {
  if (source.gitRef === undefined) {
    return loadRdfResult({ sources: source.glob, logger: options.logger }).map(
      (sub) => applyGlobTransforms(sub, transforms),
    );
  }
  return pinAndLoadGlob(source, transforms, options);
}

function pinAndLoadGlob(
  source: ParsedGlobSource,
  transforms: ReadonlyArray<ParsedTransform>,
  options: ResolveSourceResultOptions,
): ResultAsync<LoadResult, SourceError> {
  const port = options.gitPort ?? new GitCliPort();
  const repoDiscovery = options.repoDiscovery ?? defaultRepoDiscovery;
  const configDir = options.configDir ?? process.cwd();

  return pinGlobSource(
    { source, configDir },
    { port, repoDiscovery, logger: options.logger },
  )
    .mapErr<SourceError>((e) => e)
    .andThen<LoadResult, SourceError>((pinned) =>
      loadRdfResult({
        sources: source.glob,
        logger: options.logger,
        contentReader: pinned.contentReader,
      })
        .map((sub) =>
          applyGlobTransforms(sub, transforms, {
            ref: pinned.ref,
            sha: pinned.resolvedSha,
          }),
        )
        .orElse((err) => mapPinnedLoadError(err)),
    );
}

function applyGlobTransforms(
  sub: LoadResult,
  transforms: ReadonlyArray<ParsedTransform>,
  pin?: { ref: string; sha: string },
): LoadResult {
  const transformed = applyTransformPipeline(sub.store, transforms, {
    perFileRecords: sub.perFileRecords,
    pin,
  });
  return {
    store: transformed,
    files: [...sub.files],
    prefixes: { ...sub.prefixes },
    perFileRecords: sub.perFileRecords,
  };
}

function mapPinnedLoadError(
  err: SourceError,
): ResultAsync<LoadResult, SourceError> {
  // The contentReader can throw PinnedFileMissingError when a working-tree
  // match is absent from the git tree at the resolved revision. The loader
  // surfaces that as a glob-load error wrapping the thrown message; promote
  // it to a typed git-pin error so the surface decorators can render it.
  if (
    err.kind === 'glob-load' &&
    err.message.includes('pinned source: file ')
  ) {
    return errAsync<LoadResult, SourceError>({
      kind: 'git-pin',
      reason: 'pinned-file-missing',
      message: err.message,
    });
  }
  return errAsync<LoadResult, SourceError>(err);
}

function loadFileIntoStore(
  source: ParsedFileSource,
  transforms: ReadonlyArray<ParsedTransform>,
  options: ResolveSourceResultOptions,
): ResultAsync<LoadResult, SourceError> {
  // A synthesized file child resolves like a one-file glob — same loader,
  // same transform pipeline (ADR-0027). When the child inherited a pin from
  // its parent split-glob meta (ADR-0029), the loader reads from the git tree
  // at the resolved SHA instead of the working tree.
  const pin = pinFromFileSource(source);
  if (pin === null) {
    return loadRdfResult({ sources: source.path, logger: options.logger }).map(
      (sub) =>
        materializeFileLoad(sub, transforms),
    );
  }
  // Pinned child: its working-tree file may be absent (deleted-after-ref) or
  // stale (modified-after-ref). Bypass `tinyglobby` enumeration — the
  // synthesized child already names the exact git-tree path — and parse the
  // bytes returned by the git-tree contentReader directly (ADR-0029).
  const port = options.gitPort ?? new GitCliPort();
  const contentReader = makeGitTreeContentReader(port, pin);
  return ResultAsync.fromPromise(
    contentReader(source.path),
    (err) => ({
      kind: 'glob-load' as const,
      glob: [source.path],
      file: source.path,
      message: err instanceof Error ? err.message : String(err),
    }),
  )
    .andThen<LoadResult, SourceError>((buf) => {
      if (buf === null) {
        return errAsync<LoadResult, SourceError>({
          kind: 'glob-load',
          glob: [source.path],
          file: source.path,
          message: `pinned source: file ${source.path} not found at ${pin.resolvedSha}`,
        });
      }
      return parseRdfFileResult(source.path, { contentOverride: buf })
        .map((result) => {
          const store = new Store();
          for (const { quad } of result.records) store.addQuad(quad);
          const perFileRecords = new Map<
            string,
            ReadonlyArray<import('../engine').RdfRecord>
          >();
          perFileRecords.set(source.path, result.records);
          const sub: LoadResult = {
            store,
            files: [source.path],
            prefixes: { [source.path]: result.prefixes },
            perFileRecords,
          };
          return materializeFileLoad(sub, transforms, {
            ref: pin.ref,
            sha: pin.resolvedSha,
          });
        })
        .mapErr<SourceError>((err) => err);
    })
    .orElse((err) => mapPinnedLoadError(err));
}

function pinFromFileSource(
  source: ParsedFileSource,
): { ref: string; resolvedSha: string; repoRoot: string } | null {
  if (
    source.gitRef === undefined ||
    source.resolvedSha === undefined ||
    source.repoRoot === undefined
  ) {
    return null;
  }
  return {
    ref: source.gitRef,
    resolvedSha: source.resolvedSha,
    repoRoot: source.repoRoot,
  };
}

function makeGitTreeContentReader(
  port: GitPort,
  pin: { ref: string; resolvedSha: string; repoRoot: string },
): (absolutePath: string) => Promise<Buffer | null> {
  return async (absolutePath) => {
    const rel = nodePath.relative(pin.repoRoot, absolutePath);
    if (
      rel === '' ||
      rel.startsWith('..') ||
      rel.includes(`..${nodePath.sep}`)
    ) {
      throw new Error(
        `pinned file source: matched path ${absolutePath} is outside repoRoot ${pin.repoRoot}; refusing to fetch from git tree`,
      );
    }
    const gitPath = rel.split(nodePath.sep).join('/');
    const buf = await port.readFileAtSha(pin.repoRoot, pin.resolvedSha, gitPath);
    if (buf === null) {
      throw new PinnedFileMissingError(
        absolutePath,
        gitPath,
        pin.resolvedSha,
        pin.ref,
      );
    }
    return buf;
  };
}

function materializeFileLoad(
  sub: LoadResult,
  transforms: ReadonlyArray<ParsedTransform>,
  pin?: { ref: string; sha: string },
): LoadResult {
  const transformed = applyTransformPipeline(sub.store, transforms, {
    perFileRecords: sub.perFileRecords,
    pin,
  });
  return {
    store: transformed,
    files: [...sub.files],
    prefixes: { ...sub.prefixes },
    perFileRecords: sub.perFileRecords,
  };
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
