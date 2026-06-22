import * as nodePath from 'node:path';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import { Store } from 'n3';
import type { SparqlyLogger } from 'common';
import {
  loadRdfResult,
  parseRdfFileResult,
  type GraphMode,
  type LoadResult,
} from '../engine';
import type { SourceError } from './errors';
import { effectiveTransforms } from './graph-name-transform';
import {
  resolveDiskBackedFile,
  resolveDiskBackedGlob,
} from './resolve-disk-backed-glob';
import { parsePinnedFiles } from './parse-pinned-files';
import type { QuerySources } from './models';
import type {
  ParsedFileSource,
  ParsedGlobSource,
  ParsedSource,
} from './source-spec';
import { storageTier } from './glob-storage';
import { applyTransformPipeline } from './transform-pipeline';
import type { ParsedTransform } from './transform-spec';
import { GitCliPort } from './git/git-cli-port';
import type { GitPort } from './git/git-port';
import type { RepoDiscoveryDeps } from './git/discover-repo';
import {
  defaultRepoDiscovery,
  pinGlobSource,
  PinnedFileMissingError,
  type PinnedGlob,
} from './git/pin-glob-source';
import { walkGitTree, type WalkGitTreeError } from './git/walk-git-tree';
import {
  buildSourceRecordSidecar,
  type SourceRecordSidecar,
} from './source-record-sidecar';

export {
  formatRawPassThroughRejection,
  formatSourceError,
  type EndpointFetchError,
  type GlobLoadError,
  type QueryExecutionError,
  type RawPassThroughTargetError,
  type ReferenceTargetError,
  type SourceError,
  type TransformParseError,
} from './errors';

export interface ResolveSourceResultOptions {
  graphMode?: GraphMode;
  logger?: SparqlyLogger;
  /** Resolution root for `gitRoot:` relative overrides; defaults to `process.cwd()`. */
  configDir?: string;
  gitPort?: GitPort;
  repoDiscovery?: RepoDiscoveryDeps;
  sparqlyVersion?: string;
  /** Overrides the Glob index cache root for disk-backed globs. */
  indexCacheDir?: string;
}

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
    const transformsResult = effectiveTransforms(
      target.transforms,
      options.graphMode,
    );
    if (transformsResult.isErr()) return errAsync(transformsResult.error);
    const transforms = transformsResult.value;
    if (storageTier(target) === 'disk') {
      // Disk-backed indexes are keyed on `(id, glob)` only — no place to
      // record a pinned SHA, so the working tree would be indexed regardless.
      if (target.gitRef !== undefined) {
        return errAsync(diskPinUnsupportedError(target));
      }
      return resolveDiskBackedGlob(target, transforms, options);
    }
    return loadGlobIntoStore(target, transforms, options).map(materializeLoad);
  }
  const transforms = target.transforms ?? [];
  if (storageTier(target) === 'disk') {
    return resolveDiskBackedFile(target, transforms, options);
  }
  return loadFileIntoStore(target, transforms, options).map(materializeLoad);
}

interface MaterializedLoadResult extends LoadResult {
  sourceRecords: SourceRecordSidecar;
  /** The pinned commit SHA, when this load came from a `gitRef` pin (#415). */
  resolvedSha?: string;
}

function loadGlobIntoStore(
  source: ParsedGlobSource,
  transforms: ReadonlyArray<ParsedTransform>,
  options: ResolveSourceResultOptions,
): ResultAsync<MaterializedLoadResult, SourceError> {
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
): ResultAsync<MaterializedLoadResult, SourceError> {
  const port = options.gitPort ?? new GitCliPort();
  const repoDiscovery = options.repoDiscovery ?? defaultRepoDiscovery;
  const configDir = options.configDir ?? process.cwd();

  return pinGlobSource(
    { source, configDir },
    { port, repoDiscovery, logger: options.logger },
  )
    .mapErr<SourceError>((e) => e)
    .andThen<MaterializedLoadResult, SourceError>((pinned) => {
      const transformPin = { ref: pinned.ref, sha: pinned.resolvedSha };
      if (source.splitByFile === true) {
        // Enumerate from the git tree at the resolved SHA so the load sees the
        // ref-time file set, not the working tree's.
        return loadPinnedSplitGlob(source, pinned, port, repoDiscovery)
          .map((sub) => applyGlobTransforms(sub, transforms, transformPin));
      }
      return loadRdfResult({
        sources: source.glob,
        logger: options.logger,
        contentReader: pinned.contentReader,
      })
        .map((sub) => applyGlobTransforms(sub, transforms, transformPin))
        .orElse((err) => mapPinnedLoadError(err));
    });
}

function loadPinnedSplitGlob(
  source: ParsedGlobSource,
  pinned: PinnedGlob,
  port: GitPort,
  repoDiscovery: RepoDiscoveryDeps,
): ResultAsync<LoadResult, SourceError> {
  return walkGitTree(
    {
      glob: source.glob,
      repoRoot: pinned.repoRoot,
      sha: pinned.resolvedSha,
    },
    { gitPort: port, repoDiscovery },
  )
    .mapErr<SourceError>((err) => walkErrorToSourceError(err, source.glob))
    .andThen((files) =>
      parsePinnedFiles(files, source.glob, port, pinned.repoRoot, pinned.resolvedSha),
    );
}

function walkErrorToSourceError(
  err: WalkGitTreeError,
  glob: string,
): SourceError {
  if (err.kind === 'spans-multiple-repos') {
    return { kind: 'git-pin', reason: 'no-repo-found', message: err.message };
  }
  return {
    kind: 'glob-load',
    glob: [glob],
    file: glob,
    message: err.message,
  };
}

function applyGlobTransforms(
  sub: LoadResult,
  transforms: ReadonlyArray<ParsedTransform>,
  pin?: { ref: string; sha: string },
): MaterializedLoadResult {
  const transformed = applyTransformPipeline(sub.store, transforms, {
    perFileRecords: sub.perFileRecords,
    pin,
  });
  return {
    store: transformed,
    files: [...sub.files],
    prefixes: { ...sub.prefixes },
    perFileRecords: sub.perFileRecords,
    sourceRecords: buildSourceRecordSidecar(
      sub.perFileRecords ?? new Map(),
      pin,
    ),
    ...(pin === undefined ? {} : { resolvedSha: pin.sha }),
  };
}

function mapPinnedLoadError(
  err: SourceError,
): ResultAsync<MaterializedLoadResult, SourceError> {
  // Promote a wrapped PinnedFileMissingError to a typed git-pin error.
  if (
    err.kind === 'glob-load' &&
    err.message.includes('pinned source: file ')
  ) {
    return errAsync<MaterializedLoadResult, SourceError>({
      kind: 'git-pin',
      reason: 'pinned-file-missing',
      message: err.message,
    });
  }
  return errAsync<MaterializedLoadResult, SourceError>(err);
}

function loadFileIntoStore(
  source: ParsedFileSource,
  transforms: ReadonlyArray<ParsedTransform>,
  options: ResolveSourceResultOptions,
): ResultAsync<MaterializedLoadResult, SourceError> {
  const pin = pinFromFileSource(source);
  if (pin === null) {
    return loadRdfResult({ sources: source.path, logger: options.logger }).map(
      (sub) =>
        materializeFileLoad(sub, transforms),
    );
  }
  // Pinned child: bypass tinyglobby and read bytes from the git-tree contentReader.
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
    .andThen<MaterializedLoadResult, SourceError>((buf) => {
      if (buf === null) {
        return errAsync<MaterializedLoadResult, SourceError>({
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
): MaterializedLoadResult {
  const transformed = applyTransformPipeline(sub.store, transforms, {
    perFileRecords: sub.perFileRecords,
    pin,
  });
  return {
    store: transformed,
    files: [...sub.files],
    prefixes: { ...sub.prefixes },
    perFileRecords: sub.perFileRecords,
    sourceRecords: buildSourceRecordSidecar(
      sub.perFileRecords ?? new Map(),
      pin,
    ),
    ...(pin === undefined ? {} : { resolvedSha: pin.sha }),
  };
}

function diskPinUnsupportedError(
  source: ParsedGlobSource,
): SourceError {
  return {
    kind: 'glob-load',
    glob: [source.glob],
    message:
      `\`storage: disk\` does not support \`gitRef\` (or \`--at\`) — a ` +
      `disk-backed index is keyed on its glob, not a pinned SHA, so the ` +
      `pin would be silently ignored and the working tree indexed instead. ` +
      `Drop \`gitRef\` or use \`storage: memory\`.`,
  };
}

function materialized(
  store: Store,
  files: string[],
  prefixes: Record<string, Record<string, string>>,
  sourceRecords?: SourceRecordSidecar,
  resolvedSha?: string,
): QuerySources {
  const base = { mode: 'materialized' as const, store, files, prefixes };
  return {
    ...base,
    ...(sourceRecords === undefined ? {} : { sourceRecords }),
    ...(resolvedSha === undefined ? {} : { resolvedSha }),
  };
}

function materializeLoad(loaded: MaterializedLoadResult): QuerySources {
  return materialized(
    loaded.store,
    loaded.files,
    loaded.prefixes,
    loaded.sourceRecords,
    loaded.resolvedSha,
  );
}
