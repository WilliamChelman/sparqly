import { stat } from 'node:fs/promises';
import type * as RDF from '@rdfjs/types';
import { DataFactory } from 'n3';
import { ResultAsync } from 'neverthrow';
import { Quadstore } from 'quadstore';
import type { GlobLoadError } from '../sources/errors';
import { createGlobIndexBackend } from './glob-index-backend';
import { buildGlobIndex, type BuildGlobIndexOptions } from './glob-index-builder';
import { indexDbDir, indexManifestPath } from './glob-index-layout';
import { readGlobIndexManifest } from './index-manifest';

/**
 * Glob index handle (ADR-0041). Wraps an opened quadstore index and exposes it
 * as an RDF/JS source the standard query engine consumes through Comunica's
 * `sources: [...]` context — so a disk-backed glob answers SPARQL identically
 * to an in-memory one.
 */
export interface GlobIndexHandle {
  /**
   * The on-disk quad store as an RDF/JS source. Flows straight into the query
   * engine; no second engine, no behavioural change (ADR-0041).
   */
  source: RDF.Source;
  /**
   * Absolute paths of the files baked into the index, read from its manifest.
   */
  files: string[];
  /**
   * Releases the embedded LevelDB lock. Must be called once the handle is no
   * longer needed — a single index directory cannot be reopened while a prior
   * handle is still open.
   */
  close(): Promise<void>;
}

/**
 * Opens an existing {@link GlobIndexHandle} at `indexDir`. The directory must
 * already hold a built index (see `buildGlobIndex`).
 */
export async function openGlobIndex(indexDir: string): Promise<GlobIndexHandle> {
  const manifest = await readGlobIndexManifest(indexDir);
  const store = new Quadstore({
    backend: createGlobIndexBackend(indexDbDir(indexDir)),
    dataFactory: DataFactory,
  });
  await store.open();
  return {
    source: store as unknown as RDF.Source,
    files: manifest.files.map((file) => file.path),
    close: () => store.close(),
  };
}

/**
 * Opens the Glob index at `options.indexDir`, building it first if none exists.
 *
 * Reuse is naive (#338): a manifest file present at `indexDir` is taken as
 * proof of a fully built index — it is written last by `buildGlobIndex` — and
 * the index is opened as-is, with no check that the matched source files still
 * match their recorded fingerprints. Staleness detection is a later slice.
 */
export function openOrBuildGlobIndex(
  options: BuildGlobIndexOptions,
): ResultAsync<GlobIndexHandle, GlobLoadError> {
  return ResultAsync.fromSafePromise(manifestExists(options.indexDir)).andThen(
    (exists) =>
      exists
        ? ResultAsync.fromSafePromise(openGlobIndex(options.indexDir))
        : buildGlobIndex(options).map((built) => openGlobIndex(built.indexDir)),
  );
}

/** Whether a manifest — `buildGlobIndex`'s last write — exists at `indexDir`. */
async function manifestExists(indexDir: string): Promise<boolean> {
  try {
    await stat(indexManifestPath(indexDir));
    return true;
  } catch {
    return false;
  }
}
