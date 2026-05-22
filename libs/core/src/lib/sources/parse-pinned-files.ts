import * as nodePath from 'node:path';
import { ResultAsync } from 'neverthrow';
import { Store } from 'n3';
import {
  parseRdfFileResult,
  type LoadResult,
  type RdfRecord,
} from '../engine';
import type { GitPort } from './git/git-port';
import type { SourceError } from './errors';

/**
 * Parses a pinned split-glob's RDF files straight from the git tree at the
 * resolved SHA (ADR-0029), bypassing the working tree. A per-file parse
 * failure — or a pinned file unexpectedly absent at the SHA — surfaces as a
 * tagged `SourceError` on the `Result` channel.
 */
export function parsePinnedFiles(
  files: ReadonlyArray<string>,
  glob: string,
  port: GitPort,
  repoRoot: string,
  sha: string,
): ResultAsync<LoadResult, SourceError> {
  return ResultAsync.fromPromise(
    parsePinnedFilesAsync(files, glob, port, repoRoot, sha),
    (err): SourceError =>
      isSourceError(err)
        ? err
        : {
            kind: 'glob-load',
            glob: [glob],
            file: glob,
            message: err instanceof Error ? err.message : String(err),
          },
  );
}

async function parsePinnedFilesAsync(
  files: ReadonlyArray<string>,
  glob: string,
  port: GitPort,
  repoRoot: string,
  sha: string,
): Promise<LoadResult> {
  const store = new Store();
  const prefixes: Record<string, Record<string, string>> = {};
  const perFileRecords = new Map<string, ReadonlyArray<RdfRecord>>();
  const repoRelPaths = files.map((abs) => repoRelative(abs, repoRoot));
  const repoRelToAbs = new Map(repoRelPaths.map((rel, i) => [rel, files[i]]));
  for await (const { path, bytes } of port.readManyAtSha(
    repoRoot,
    sha,
    repoRelPaths,
  )) {
    const absolute = repoRelToAbs.get(path) ?? path;
    if (bytes === null) {
      throw {
        kind: 'git-pin',
        reason: 'pinned-file-missing',
        message: `pinned source: file ${absolute} unexpectedly absent at the resolved SHA`,
      } satisfies SourceError;
    }
    const parsed = await parseRdfFileResult(absolute, {
      contentOverride: bytes,
    });
    if (parsed.isErr()) {
      throw {
        kind: 'glob-load',
        glob: [glob],
        file: absolute,
        message: parsed.error.message,
      } satisfies SourceError;
    }
    for (const { quad } of parsed.value.records) store.addQuad(quad);
    prefixes[absolute] = parsed.value.prefixes;
    perFileRecords.set(absolute, parsed.value.records);
  }
  return {
    store,
    files: [...files],
    prefixes,
    perFileRecords,
  };
}

function repoRelative(absolutePath: string, repoRoot: string): string {
  const rel = nodePath.relative(repoRoot, absolutePath);
  if (rel === '' || rel.startsWith('..') || rel.includes(`..${nodePath.sep}`)) {
    throw new Error(
      `pinned source: matched path ${absolutePath} is outside repoRoot ${repoRoot}; refusing to fetch from git tree`,
    );
  }
  return rel.split(nodePath.sep).join('/');
}

function isSourceError(value: unknown): value is SourceError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in (value as Record<string, unknown>) &&
    typeof (value as { kind: unknown }).kind === 'string'
  );
}
