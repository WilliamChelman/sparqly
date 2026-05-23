import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { glob as tinyGlob } from 'tinyglobby';
import type { ParsedTransform } from '../sources/transform-spec';
import type { BuildGlobIndexOptions } from './glob-index-builder';
import { indexManifestPath } from './glob-index-layout';

export interface IndexedFileEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface TransformFingerprint {
  key: string;
  config?: unknown;
}

export interface GlobIndexManifest {
  files: IndexedFileEntry[];
  sparqlyVersion: string;
  transforms: TransformFingerprint[];
  /** Not part of the freshness fingerprint — only the build path produces a count. */
  quadCount?: number;
}

export interface ComputeManifestInput {
  files: ReadonlyArray<string>;
  transforms: ReadonlyArray<ParsedTransform>;
  sparqlyVersion: string;
  /** Omit on the freshness-inspect path — only the build path knows it. */
  quadCount?: number;
}

/** Build-time callers must snapshot up front with {@link snapshotIndexedFiles} to avoid TOCTOU. */
export async function computeGlobIndexManifest(
  input: ComputeManifestInput,
): Promise<GlobIndexManifest> {
  return manifestFromFingerprints({
    files: await snapshotIndexedFiles(input.files),
    transforms: input.transforms,
    sparqlyVersion: input.sparqlyVersion,
    quadCount: input.quadCount,
  });
}

export interface ManifestFromFingerprintsInput {
  files: ReadonlyArray<IndexedFileEntry>;
  transforms: ReadonlyArray<ParsedTransform>;
  sparqlyVersion: string;
  /** Omitted on the freshness-inspect path; absence distinguishes "unknown" from "really zero". */
  quadCount?: number;
}

export function manifestFromFingerprints(
  input: ManifestFromFingerprintsInput,
): GlobIndexManifest {
  const manifest: GlobIndexManifest = {
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
  if (input.quadCount !== undefined) manifest.quadCount = input.quadCount;
  return manifest;
}

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

export async function readGlobIndexManifest(
  indexDir: string,
): Promise<GlobIndexManifest> {
  const raw = await readFile(indexManifestPath(indexDir), 'utf8');
  return JSON.parse(raw) as GlobIndexManifest;
}

export async function manifestExists(indexDir: string): Promise<boolean> {
  try {
    await stat(indexManifestPath(indexDir));
    return true;
  } catch {
    return false;
  }
}

export type GlobIndexStaleness =
  | { verdict: 'fresh' }
  | { verdict: 'stale'; reason: string };

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

export type GlobIndexFreshness = { verdict: 'absent' } | GlobIndexStaleness;

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
