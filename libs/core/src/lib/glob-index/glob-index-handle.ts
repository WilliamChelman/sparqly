import { stat } from 'node:fs/promises';
import type * as RDF from '@rdfjs/types';
import type { SparqlyLogger } from 'common';
import { DataFactory } from 'n3';
import { ResultAsync } from 'neverthrow';
import { Quadstore } from 'quadstore';
import { glob as tinyGlob } from 'tinyglobby';
import type { GlobLoadError } from '../sources/errors';
import { createGlobIndexBackend } from './glob-index-backend';
import { buildGlobIndex, type BuildGlobIndexOptions } from './glob-index-builder';
import { indexDbDir, indexManifestPath } from './glob-index-layout';
import {
  compareGlobIndexManifests,
  computeGlobIndexManifest,
  readGlobIndexManifest,
} from './index-manifest';

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

/** Options for {@link openOrBuildGlobIndex}. */
export interface OpenOrBuildGlobIndexOptions extends BuildGlobIndexOptions {
  /**
   * Boundary logger for the staleness `warn` (ADR-0041, ADR-0020). When an
   * already-built index no longer matches its inputs, one `warn` line names
   * the staleness — sparqly never rebuilds an index behind the user's back.
   */
  logger?: SparqlyLogger;
}

/**
 * Opens the Glob index at `options.indexDir`, building it first if none exists.
 *
 * When an index is already present its manifest is compared against the
 * current matched file set (ADR-0041): a fresh index is reused as-is; a stale
 * index is *also* reused — but emits one `warn`-level boundary log naming the
 * staleness. sparqly never rebuilds an index implicitly; rebuilds are too
 * heavy to trigger behind the user's back.
 */
export function openOrBuildGlobIndex(
  options: OpenOrBuildGlobIndexOptions,
): ResultAsync<GlobIndexHandle, GlobLoadError> {
  return ResultAsync.fromSafePromise(manifestExists(options.indexDir)).andThen(
    (exists) =>
      exists
        ? ResultAsync.fromSafePromise(reuseGlobIndex(options))
        : buildGlobIndex(options).map((built) => openGlobIndex(built.indexDir)),
  );
}

/**
 * Reuses the already-built index at `options.indexDir`, comparing its manifest
 * against the current matched files first: a stale verdict emits one `warn`
 * naming the change, but the index is opened as-is either way (ADR-0041).
 */
async function reuseGlobIndex(
  options: OpenOrBuildGlobIndexOptions,
): Promise<GlobIndexHandle> {
  const prior = await readGlobIndexManifest(options.indexDir);
  const current = await computeGlobIndexManifest({
    files: await tinyGlob(options.glob, { absolute: true }),
    transforms: options.transforms,
    sparqlyVersion: options.sparqlyVersion,
  });
  const staleness = compareGlobIndexManifests(prior, current);
  if (staleness.verdict === 'stale') {
    options.logger?.warn(
      `Disk-backed glob index at ${options.indexDir} is stale (${staleness.reason}) — reusing it as-is; sparqly does not rebuild an index automatically.`,
    );
  }
  return openGlobIndex(options.indexDir);
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
