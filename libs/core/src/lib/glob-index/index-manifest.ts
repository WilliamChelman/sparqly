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

/**
 * One transform's fingerprint in the manifest (ADR-0041). The `key` identifies
 * the transform; the `config` is its JSON-serializable build-time
 * configuration (e.g. `graphName`'s mode and graph override). Both are
 * compared on open — re-pointing a transform's config bakes different quads,
 * so a config change registers the index as stale just like a key change.
 */
export interface TransformFingerprint {
  /** Transform key (e.g. `graphName`). */
  key: string;
  /** JSON-serializable build-time config, omitted when the transform has none. */
  config?: unknown;
}

export interface GlobIndexManifest {
  /** Fingerprint of every indexed file, in index-build order. */
  files: IndexedFileEntry[];
  /** The sparqly version that built the index. */
  sparqlyVersion: string;
  /** The transform pipeline applied at build time — key + config, in order. */
  transforms: TransformFingerprint[];
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
    transforms: input.transforms.map((transform) =>
      transform.config === undefined
        ? { key: transform.key }
        : { key: transform.key, config: transform.config },
    ),
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
  // Transform order is part of the pipeline (ADR-0006), and a transform's
  // config is baked into the index (ADR-0041) — compare key and config in
  // sequence so re-pointing either registers as staleness.
  if (!transformsMatch(prior.transforms, current.transforms)) {
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

/**
 * Whether two transform pipelines are identical — same keys, same order, same
 * per-transform config. Config is compared by JSON shape: both sides are
 * built by the same parser, so key order is stable, and a manifest read from
 * disk round-trips through `JSON.parse` of that same serialization.
 */
function transformsMatch(
  prior: ReadonlyArray<TransformFingerprint>,
  current: ReadonlyArray<TransformFingerprint>,
): boolean {
  if (prior.length !== current.length) return false;
  return prior.every((transform, i) => {
    const other = current[i];
    return (
      transform.key === other.key &&
      JSON.stringify(transform.config) === JSON.stringify(other.config)
    );
  });
}
