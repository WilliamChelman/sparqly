import { DataFactory, Store } from 'n3';
import { ResultAsync } from 'neverthrow';
import { Quadstore } from 'quadstore';
import { glob as tinyGlob } from 'tinyglobby';
import { parseRdfFileResult, type RdfRecord } from '../engine/rdf-file-parser';
import type { GlobLoadError } from '../sources/errors';
import { applyTransformPipeline } from '../sources/transform-pipeline';
import type { ParsedTransform } from '../sources/transform-spec';
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
  const store = new Quadstore({
    backend: createGlobIndexBackend(indexDbDir(options.indexDir)),
    dataFactory: DataFactory,
  });
  await store.open();
  try {
    if (options.transforms.length === 0) {
      // No transforms: stream each file's quads straight to disk — the index
      // never holds the whole glob in RAM, which is the disk tier's purpose.
      for (const file of files) {
        const parsed = await parseRdfFileResult(file);
        if (parsed.isErr()) throw parsed.error;
        await store.multiPut(parsed.value.records.map((record) => record.quad));
      }
    } else {
      // Transforms bake at build time (ADR-0041, amends ADR-0006). The
      // pipeline operates on a whole `n3.Store` with per-file provenance, so
      // the glob is materialized in memory for the transform pass, then the
      // transformed quads are written to the index.
      const transformed = await transformGlob(files, options.transforms);
      await store.multiPut(transformed.getQuads(null, null, null, null));
    }
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
 * Parses every matched file into an in-memory `n3.Store`, then runs the
 * transform pipeline over it with per-file provenance — the same context the
 * in-memory glob loader threads, so a disk-backed glob's transforms behave
 * identically (ADR-0041).
 */
async function transformGlob(
  files: ReadonlyArray<string>,
  transforms: ReadonlyArray<ParsedTransform>,
): Promise<Store> {
  const store = new Store();
  const perFileRecords = new Map<string, ReadonlyArray<RdfRecord>>();
  for (const file of files) {
    const parsed = await parseRdfFileResult(file);
    if (parsed.isErr()) throw parsed.error;
    for (const { quad } of parsed.value.records) store.addQuad(quad);
    perFileRecords.set(file, parsed.value.records);
  }
  return applyTransformPipeline(store, transforms, { perFileRecords });
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
