import { stat } from 'node:fs/promises';
import type * as RDF from '@rdfjs/types';
import { DataFactory } from 'n3';
import { ResultAsync } from 'neverthrow';
import { Quadstore } from 'quadstore';
import { glob as tinyGlob } from 'tinyglobby';
import type { GlobLoadError } from '../sources/errors';
import { buildGlobIndexAtomic } from './atomic-build';
import { createGlobIndexBackend } from './glob-index-backend';
import type { BuildGlobIndexOptions } from './glob-index-builder';
import { indexDbDir, indexManifestPath } from './glob-index-layout';
import {
  compareGlobIndexManifests,
  computeGlobIndexManifest,
  readGlobIndexManifest,
} from './index-manifest';

export interface GlobIndexHandle {
  source: RDF.Source;
  files: string[];
  /** Releases the embedded LevelDB lock; the dir cannot be reopened while a handle is open. */
  close(): Promise<void>;
}

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

export type OpenOrBuildGlobIndexOptions = BuildGlobIndexOptions;

/** Opens the Glob index, building if absent. A stale index is reused with a warn — sparqly never rebuilds implicitly. */
export function openOrBuildGlobIndex(
  options: OpenOrBuildGlobIndexOptions,
): ResultAsync<GlobIndexHandle, GlobLoadError> {
  return ResultAsync.fromSafePromise(manifestExists(options.indexDir)).andThen(
    (exists) =>
      exists
        ? ResultAsync.fromPromise(reuseGlobIndex(options), (err) =>
            toGlobLoadError(options.glob, err),
          )
        : buildGlobIndexAtomic(options).andThen((built) =>
            ResultAsync.fromPromise(openGlobIndex(built.indexDir), (err) =>
              toGlobLoadError(options.glob, err),
            ),
          ),
  );
}

function toGlobLoadError(
  glob: string | string[],
  err: unknown,
): GlobLoadError {
  return {
    kind: 'glob-load',
    glob: Array.isArray(glob) ? [...glob] : [glob],
    message: err instanceof Error ? err.message : String(err),
  };
}

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

async function manifestExists(indexDir: string): Promise<boolean> {
  try {
    await stat(indexManifestPath(indexDir));
    return true;
  } catch {
    return false;
  }
}
