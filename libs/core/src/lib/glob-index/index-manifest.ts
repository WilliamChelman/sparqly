import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { ParsedTransform } from '../sources/transform-spec';
import { indexManifestPath } from './glob-index-layout';

/**
 * Index manifest (ADR-0041). Written alongside a Glob index, the manifest
 * fingerprints the index against its inputs: every indexed file's path, size
 * and mtime; the sparqly version that built it; and the transform pipeline
 * baked into it. A later slice compares a stored manifest against the current
 * file set to detect staleness — #338 only computes and writes it.
 */

/** One indexed file's fingerprint at index-build time. */
export interface IndexedFileEntry {
  /** Absolute path of the indexed file. */
  path: string;
  /** File size in bytes. */
  size: number;
  /** File mtime in epoch milliseconds. */
  mtimeMs: number;
}

export interface GlobIndexManifest {
  /** Fingerprint of every indexed file, in index-build order. */
  files: IndexedFileEntry[];
  /** The sparqly version that built the index. */
  sparqlyVersion: string;
  /** Keys of the transform pipeline applied at build time, in order. */
  transforms: string[];
}

export interface ComputeManifestInput {
  /** Absolute paths of the files that were indexed. */
  files: ReadonlyArray<string>;
  /** Transform pipeline applied during the build. */
  transforms: ReadonlyArray<ParsedTransform>;
  /** The sparqly version that built the index. */
  sparqlyVersion: string;
}

/**
 * Computes a {@link GlobIndexManifest}, stat-ing each indexed file to capture
 * its size and mtime.
 */
export async function computeGlobIndexManifest(
  input: ComputeManifestInput,
): Promise<GlobIndexManifest> {
  const files: IndexedFileEntry[] = [];
  for (const path of input.files) {
    const stats = await stat(path);
    files.push({ path, size: stats.size, mtimeMs: stats.mtimeMs });
  }
  return {
    files,
    sparqlyVersion: input.sparqlyVersion,
    transforms: input.transforms.map((transform) => transform.key),
  };
}

/** Writes `manifest` as JSON alongside the index at `indexDir`. */
export async function writeGlobIndexManifest(
  indexDir: string,
  manifest: GlobIndexManifest,
): Promise<void> {
  await mkdir(indexDir, { recursive: true });
  await writeFile(
    indexManifestPath(indexDir),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );
}

/** Reads the manifest written alongside the index at `indexDir`. */
export async function readGlobIndexManifest(
  indexDir: string,
): Promise<GlobIndexManifest> {
  const raw = await readFile(indexManifestPath(indexDir), 'utf8');
  return JSON.parse(raw) as GlobIndexManifest;
}
