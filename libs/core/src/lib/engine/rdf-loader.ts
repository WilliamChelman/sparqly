import { resolve as resolvePath } from 'node:path';
import { Store } from 'n3';
import { ResultAsync, okAsync } from 'neverthrow';
import { glob } from 'tinyglobby';
import { noopLogger, type SparqlyLogger } from 'common';
import { parseRdfFileResult, type RdfRecord } from './rdf-file-parser';
import type { GlobLoadError } from '../sources/errors';

export const GRAPH_MODES = [
  'preserve',
  'fillDefault',
  'forceAll',
  'flatten',
] as const;

export type GraphMode = (typeof GRAPH_MODES)[number];

export interface LoadOptions {
  sources: string | string[];
  /**
   * Optional boundary logger. The empty-glob branch emits a single
   * `warn`-level line through this logger naming the glob pattern(s) and the
   * absolute base path that was searched (ADR-0028). Defaults to no-op.
   */
  logger?: SparqlyLogger;
}

export interface LoadResult {
  store: Store;
  files: string[];
  /** Prefixes declared in each parsed file, keyed by absolute file path. */
  prefixes: Record<string, Record<string, string>>;
  /**
   * Raw per-file records, in file order. Side-channel for the transform
   * pipeline — transforms like `graphName` need per-quad file provenance that
   * cannot be recovered from the merged Store alone. Omitted by callers that
   * synthesize a `LoadResult` without a backing file load (e.g. endpoint
   * loads in `loadSources`).
   */
  perFileRecords?: ReadonlyMap<string, ReadonlyArray<RdfRecord>>;
}

/**
 * Primary `Result`-typed loader. Returns a {@link LoadResult} on success and a
 * {@link GlobLoadError} on failure — the variant carries the glob pattern(s),
 * the offending file path when the failure is file-specific, and the wrapped
 * underlying message (ADR-0024).
 */
export function loadRdfResult(
  options: LoadOptions,
): ResultAsync<LoadResult, GlobLoadError> {
  const globs = normalizeGlobs(options.sources);
  const logger = options.logger ?? noopLogger;
  return ResultAsync.fromSafePromise(
    glob(options.sources, { absolute: true }),
  ).andThen((files) => {
    if (files.length === 0) {
      const base = globBaseDirs(globs);
      logger.warn(
        `No files matched glob ${globs.join(', ')} in ${base.join(', ')}`,
        { glob: globs, base },
      );
      return okAsync<LoadResult, GlobLoadError>({
        store: new Store(),
        files: [],
        prefixes: {},
        perFileRecords: new Map(),
      });
    }
    return parseFiles(files, globs);
  });
}

function globBaseDirs(globs: ReadonlyArray<string>): ReadonlyArray<string> {
  return globs.map((pattern) => resolvePath(staticPrefix(pattern)));
}

function staticPrefix(pattern: string): string {
  const meta = pattern.search(/[*?[{]/);
  if (meta === -1) return pattern;
  const head = pattern.slice(0, meta);
  const lastSlash = head.lastIndexOf('/');
  if (lastSlash === -1) return '.';
  return head.slice(0, lastSlash) || '/';
}

function parseFiles(
  files: string[],
  globs: ReadonlyArray<string>,
): ResultAsync<LoadResult, GlobLoadError> {
  const store = new Store();
  const prefixes: Record<string, Record<string, string>> = {};
  const perFileRecords = new Map<string, ReadonlyArray<RdfRecord>>();

  const seed: ResultAsync<void, GlobLoadError> = okAsync(undefined);
  const chain = files.reduce<ResultAsync<void, GlobLoadError>>(
    (prev, file) =>
      prev.andThen(() =>
        parseRdfFileResult(file)
          .map((result) => {
            for (const { quad } of result.records) store.addQuad(quad);
            prefixes[file] = result.prefixes;
            perFileRecords.set(file, result.records);
          })
          .mapErr<GlobLoadError>((err) => ({
            kind: 'glob-load',
            glob: globs,
            file,
            message: err.message,
          })),
      ),
    seed,
  );

  return chain.map(() => ({ store, files, prefixes, perFileRecords }));
}

function normalizeGlobs(sources: string | string[]): ReadonlyArray<string> {
  return Array.isArray(sources) ? [...sources] : [sources];
}

/**
 * @deprecated Use {@link loadRdfResult} (ADR-0024). Retained as a thin
 * throw-based adapter for callers that have not migrated yet.
 */
export async function loadRdf(options: LoadOptions): Promise<LoadResult> {
  const result = await loadRdfResult(options);
  if (result.isErr()) {
    const e = result.error;
    if (e.file !== undefined) {
      throw new Error(`Failed to parse ${e.file}: ${e.message}`);
    }
    throw new Error(e.message);
  }
  return result.value;
}
