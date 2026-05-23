import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { glob as tinyGlob } from 'tinyglobby';
import type { ParsedTransform } from '../sources/transform-spec';
import type { BuildGlobIndexOptions } from './glob-index-builder';
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
 * its size and mtime. Used by the freshness-inspect path, which needs the
 * *current* filesystem state of the matched files. Build-time callers must
 * instead snapshot stats up front with {@link snapshotIndexedFiles} and pass
 * the result to {@link manifestFromFingerprints} — re-statting after a long
 * ingest would bake any concurrent edit's mtime into the manifest, hiding
 * staleness forever.
 */
export async function computeGlobIndexManifest(
  input: ComputeManifestInput,
): Promise<GlobIndexManifest> {
  return manifestFromFingerprints({
    files: await snapshotIndexedFiles(input.files),
    transforms: input.transforms,
    sparqlyVersion: input.sparqlyVersion,
  });
}

export interface ManifestFromFingerprintsInput {
  /** Pre-stat'd fingerprints of every indexed file, in index-build order. */
  files: ReadonlyArray<IndexedFileEntry>;
  /** Transform pipeline applied during the build. */
  transforms: ReadonlyArray<ParsedTransform>;
  /** The sparqly version that built the index. */
  sparqlyVersion: string;
}

/**
 * Builds a {@link GlobIndexManifest} from pre-stat'd file fingerprints —
 * no I/O. The build path uses this with a snapshot taken *before* the ingest
 * so the manifest fingerprints the bytes the build actually read, not the
 * filesystem state after a 10-15 min stream (a TOCTOU that would silently
 * mask staleness; ADR-0041).
 */
export function manifestFromFingerprints(
  input: ManifestFromFingerprintsInput,
): GlobIndexManifest {
  return {
    files: input.files.map((file) => ({
      path: file.path,
      size: file.size,
      mtimeMs: file.mtimeMs,
    })),
    sparqlyVersion: input.sparqlyVersion,
    transforms: input.transforms.map((transform) =>
      transform.config === undefined
        ? { key: transform.key }
        : { key: transform.key, config: transform.config },
    ),
  };
}

/**
 * Stats each path into an {@link IndexedFileEntry}. The build path calls this
 * once before the ingest to capture the inputs' fingerprints up front, so a
 * file edited during the build registers as stale on the next freshness check
 * instead of being silently absorbed into the manifest (ADR-0041).
 */
export async function snapshotIndexedFiles(
  paths: ReadonlyArray<string>,
): Promise<IndexedFileEntry[]> {
  const entries: IndexedFileEntry[] = [];
  for (const path of paths) {
    const stats = await stat(path);
    entries.push({ path, size: stats.size, mtimeMs: stats.mtimeMs });
  }
  return entries;
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

/** Whether a built Glob index — its `manifest.json` — exists at `indexDir`. */
export async function manifestExists(indexDir: string): Promise<boolean> {
  try {
    await stat(indexManifestPath(indexDir));
    return true;
  } catch {
    return false;
  }
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
 * Freshness of the Glob index at an index directory (#346). `absent` means no
 * index is built there yet; otherwise it is the `fresh | stale` verdict of
 * comparing the stored manifest against one freshly computed from the current
 * matched file set — the same comparison the open path runs, surfaced for the
 * `sparqly index` command's skip-fresh / rebuild-stale decision.
 */
export type GlobIndexFreshness = { verdict: 'absent' } | GlobIndexStaleness;

/**
 * Inspects the Glob index at `options.indexDir` against the files `options.glob`
 * currently matches. Re-globs and re-stats, so the verdict reflects the file
 * set at call time.
 */
export async function inspectGlobIndexFreshness(
  options: BuildGlobIndexOptions,
): Promise<GlobIndexFreshness> {
  if (!(await manifestExists(options.indexDir))) {
    return { verdict: 'absent' };
  }
  const prior = await readGlobIndexManifest(options.indexDir);
  const current = await computeGlobIndexManifest({
    files: await tinyGlob(options.glob, { absolute: true }),
    transforms: options.transforms,
    sparqlyVersion: options.sparqlyVersion,
  });
  return compareGlobIndexManifests(prior, current);
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
