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

/**
 * Staleness verdict for a Glob index (ADR-0041). `fresh` means the index still
 * matches its inputs and can be reused; `stale` names the change that broke
 * the match so the open path can warn.
 */
export type GlobIndexStaleness =
  | { verdict: 'fresh' }
  | { verdict: 'stale'; reason: string };

/**
 * Compares the manifest a Glob index was built with (`prior`) against a
 * manifest freshly computed from the current matched file set (`current`),
 * yielding a `fresh | stale` verdict. A pure function — callers do the
 * stat I/O up front via {@link computeGlobIndexManifest}.
 */
export function compareGlobIndexManifests(
  prior: GlobIndexManifest,
  current: GlobIndexManifest,
): GlobIndexStaleness {
  if (prior.sparqlyVersion !== current.sparqlyVersion) {
    return {
      verdict: 'stale',
      reason: `sparqly version changed: ${prior.sparqlyVersion} → ${current.sparqlyVersion}`,
    };
  }
  // Transform order is part of the pipeline (ADR-0006) — compare in sequence.
  if (
    prior.transforms.length !== current.transforms.length ||
    prior.transforms.some((key, i) => key !== current.transforms[i])
  ) {
    return { verdict: 'stale', reason: 'transform pipeline changed' };
  }
  const priorByPath = new Map(prior.files.map((file) => [file.path, file]));
  const currentByPath = new Map(current.files.map((file) => [file.path, file]));
  for (const file of current.files) {
    const priorFile = priorByPath.get(file.path);
    if (priorFile === undefined) {
      return { verdict: 'stale', reason: `matched file added: ${file.path}` };
    }
    if (priorFile.size !== file.size || priorFile.mtimeMs !== file.mtimeMs) {
      return { verdict: 'stale', reason: `matched file changed: ${file.path}` };
    }
  }
  for (const file of prior.files) {
    if (!currentByPath.has(file.path)) {
      return { verdict: 'stale', reason: `matched file removed: ${file.path}` };
    }
  }
  return { verdict: 'fresh' };
}
