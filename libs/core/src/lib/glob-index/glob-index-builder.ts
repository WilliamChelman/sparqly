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
import { BuildProgress } from './build-progress';
import { createGlobIndexBackend } from './glob-index-backend';
import { indexDbDir } from './glob-index-layout';
import {
  manifestFromFingerprints,
  snapshotIndexedFiles,
  writeGlobIndexManifest,
} from './index-manifest';

export interface BuildGlobIndexOptions {
  glob: string | string[];
  transforms: ReadonlyArray<ParsedTransform>;
  indexDir: string;
  sparqlyVersion: string;
  logger?: SparqlyLogger;
}

export interface GlobIndexBuildResult {
  indexDir: string;
  files: string[];
}

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
  // Snapshot fingerprints up front to avoid absorbing a concurrent edit's
  // mtime into the manifest after a long stream (TOCTOU).
  const fingerprints = await snapshotIndexedFiles(files);
  const progress = new BuildProgress({
    files: fingerprints.map((file) => ({ path: file.path, bytes: file.size })),
    logger: options.logger,
  });
  const store = new Quadstore({
    backend: createGlobIndexBackend(indexDbDir(options.indexDir)),
    dataFactory: DataFactory,
  });
  await store.open();
  let quadCount = 0;
  try {
    quadCount = await ingestQuadStream(
      store,
      streamGlobQuads(files, options.transforms, progress),
      INGEST_BATCH_SIZE,
      (count) => progress.quadsWritten(count),
    );
  } finally {
    await store.close();
  }
  const manifest = manifestFromFingerprints({
    files: fingerprints,
    transforms: options.transforms,
    sparqlyVersion: options.sparqlyVersion,
    quadCount,
  });
  await writeGlobIndexManifest(options.indexDir, manifest);
  return { indexDir: options.indexDir, files };
}

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

function graphNameRewriteFor(
  transforms: ReadonlyArray<ParsedTransform>,
  file: string,
): (quad: Quad) => Quad {
  const rewriters = transforms.map((transform) => {
    if (transform.key !== 'graphName') {
      throw new Error(
        `disk-backed glob index supports only \`graphName\` transforms, got "${transform.key}"`,
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
