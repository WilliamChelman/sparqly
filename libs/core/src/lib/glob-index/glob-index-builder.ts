import { stat } from 'node:fs/promises';
import type { SparqlyLogger } from 'common';
import { DataFactory, type Quad } from 'n3';
import { ResultAsync } from 'neverthrow';
import { Quadstore } from 'quadstore';
import { glob as tinyGlob } from 'tinyglobby';
import { streamRdfFileQuads } from '../engine/rdf-file-parser';
import type { GlobLoadError } from '../sources/errors';
import {
  graphNameQuadRewriter,
  type GraphNameConfig,
} from '../sources/graph-name-transform';
import type { ParsedTransform } from '../sources/transform-spec';
import { INGEST_BATCH_SIZE, ingestQuadStream } from './batched-ingest';
import { BuildProgress, type BuildProgressFile } from './build-progress';
import { createGlobIndexBackend } from './glob-index-backend';
import { indexDbDir } from './glob-index-layout';
import { computeGlobIndexManifest, writeGlobIndexManifest } from './index-manifest';

/**
 * Glob index builder (ADR-0041). Streams each file matched by a glob into a
 * persistent quadstore index at a target directory. The index is the
 * disk-backed counterpart of the in-memory `n3.Store` a `storage: memory`
 * glob materializes into — every quad lands on disk, so a glob whose triples
 * exceed RAM stays buildable.
 */
export interface BuildGlobIndexOptions {
  /** Glob pattern(s) selecting the RDF files to index. */
  glob: string | string[];
  /** Transform pipeline baked into the index at build time. */
  transforms: ReadonlyArray<ParsedTransform>;
  /** Target directory the LevelDB-backed index is written under. */
  indexDir: string;
  /** The sparqly version recorded in the index manifest. */
  sparqlyVersion: string;
  /**
   * Boundary logger for the build's progress events (#349, ADR-0020/-0042):
   * `index-file-start` / `index-file-done` per matched file and a throttled
   * `index-progress` heartbeat, all at `info`. Also carries the staleness
   * `warn` on the open path (see `openOrBuildGlobIndex`). Omit to build
   * silently.
   */
  logger?: SparqlyLogger;
}

export interface GlobIndexBuildResult {
  /** Directory the index was written under. */
  indexDir: string;
  /** Absolute paths of the files indexed, in glob-enumeration order. */
  files: string[];
}

/**
 * Builds a {@link GlobIndexBuildResult} by streaming every matched file into a
 * quadstore index at `indexDir`. A parse failure on any file surfaces as a
 * {@link GlobLoadError} naming the offending file (ADR-0024).
 */
export function buildGlobIndex(
  options: BuildGlobIndexOptions,
): ResultAsync<GlobIndexBuildResult, GlobLoadError> {
  return ResultAsync.fromPromise(buildGlobIndexAsync(options), (err) =>
    isGlobLoadError(err)
      ? err
      : {
          kind: 'glob-load',
          glob: normalizeGlobs(options.glob),
          message: err instanceof Error ? err.message : String(err),
        },
  );
}

async function buildGlobIndexAsync(
  options: BuildGlobIndexOptions,
): Promise<GlobIndexBuildResult> {
  const files = await tinyGlob(options.glob, { absolute: true });
  // Sizing the matched files upfront gives the heartbeat a real byte-% — its
  // denominator is known before a single quad is read (#349).
  const progress = new BuildProgress({
    files: await statFiles(files),
    logger: options.logger,
  });
  const store = new Quadstore({
    backend: createGlobIndexBackend(indexDbDir(options.indexDir)),
    dataFactory: DataFactory,
  });
  await store.open();
  try {
    // Stream every matched file's quads through a fixed-size batched ingest
    // (#347), applying the `graphName` transform inline as a per-quad rewrite
    // (#348). The build never materializes a whole file — let alone the whole
    // glob — in heap: at most one batch is resident, whether or not a
    // transform is declared. That flat memory ceiling is the disk tier's
    // purpose (ADR-0041, amends ADR-0006). Each written batch advances the
    // `index-progress` heartbeat (#349).
    await ingestQuadStream(
      store,
      streamGlobQuads(files, options.transforms, progress),
      INGEST_BATCH_SIZE,
      (count) => progress.quadsWritten(count),
    );
  } finally {
    await store.close();
  }
  const manifest = await computeGlobIndexManifest({
    files,
    transforms: options.transforms,
    sparqlyVersion: options.sparqlyVersion,
  });
  await writeGlobIndexManifest(options.indexDir, manifest);
  return { indexDir: options.indexDir, files };
}

/**
 * Concatenates every matched file's quad stream into one lazy quad stream in
 * glob-enumeration order, applying the `graphName` transform inline as a
 * per-quad graph-term rewrite (#348). A disk-backed glob's only legal
 * transform is `graphName` (ADR-0041), a pure per-quad rewrite — so the build
 * never materializes the whole glob in heap whether or not a transform is
 * declared. A parse failure on any file surfaces as the {@link GlobLoadError}
 * {@link streamRdfFileQuads} throws, naming that file. Brackets each file's
 * quads with `progress.fileStarted` / `fileDone` so the build reports per-file
 * progress (#349).
 */
async function* streamGlobQuads(
  files: ReadonlyArray<string>,
  transforms: ReadonlyArray<ParsedTransform>,
  progress: BuildProgress,
): AsyncGenerator<Quad> {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    progress.fileStarted(i);
    const rewrite = graphNameRewriteFor(transforms, file);
    for await (const quad of streamRdfFileQuads(file)) {
      yield rewrite(quad);
    }
    progress.fileDone(i);
  }
}

/** Sizes each matched file for the build's byte-% heartbeat (#349). */
async function statFiles(
  files: ReadonlyArray<string>,
): Promise<BuildProgressFile[]> {
  return Promise.all(
    files.map(async (path) => ({ path, bytes: (await stat(path)).size })),
  );
}

/**
 * Composes the per-file `graphName` rewrite the streamed ingest applies as
 * quads flow by. ADR-0041 restricts a disk-backed glob to `graphName`
 * transforms; a non-`graphName` transform reaching the builder is an
 * invariant violation, not user error. An empty pipeline yields the identity
 * rewrite, so an un-transformed build streams unchanged.
 */
function graphNameRewriteFor(
  transforms: ReadonlyArray<ParsedTransform>,
  file: string,
): (quad: Quad) => Quad {
  const rewriters = transforms.map((transform) => {
    if (transform.key !== 'graphName') {
      throw new Error(
        `disk-backed glob index supports only \`graphName\` transforms (ADR-0041), got "${transform.key}"`,
      );
    }
    return graphNameQuadRewriter(transform.config as GraphNameConfig, file);
  });
  return (quad) => rewriters.reduce((q, rewrite) => rewrite(q), quad);
}

function normalizeGlobs(glob: string | string[]): string[] {
  return Array.isArray(glob) ? [...glob] : [glob];
}

function isGlobLoadError(value: unknown): value is GlobLoadError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'glob-load'
  );
}
