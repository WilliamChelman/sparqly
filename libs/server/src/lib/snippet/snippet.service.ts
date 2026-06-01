import { existsSync, statSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import {
  discoverRepoRoot,
  GitCliPort,
  readGitFileSnippets,
  readSourceSnippets,
  type FocalRange,
  type GitPort,
  type RepoDiscoveryDeps,
  type SnippetReadResult,
  type SourceSnippet,
} from 'core';
import type { SnippetError } from './errors';

export interface ReadSnippetsRequest {
  file: string;
  rangeSpecs: ReadonlyArray<string>;
  context: number;
  /**
   * Commit SHA of the pinned side this snippet belongs to (ADR-0029). When
   * set, content is read from that git blob instead of the working tree so the
   * recorded line numbers — computed against the pin — stay aligned with the
   * displayed text. Absent for unpinned (working-tree) sources.
   */
  gitSha?: string;
}

export interface ReadSnippetsOk {
  snippets: SourceSnippet[];
}

/**
 * Injectable filesystem seam: production wraps `readSourceSnippets` from core;
 * the spec passes a stub so request-time fs failures can be simulated without
 * touching disk.
 */
export interface SnippetReader {
  readByFocalRanges(
    file: string,
    ranges: ReadonlyArray<FocalRange>,
    context: number,
    /** When set, read the pinned git blob at this commit SHA, not disk. */
    gitSha?: string,
  ): Promise<SnippetReadResult[]>;
}

export const SNIPPET_READER = Symbol('SNIPPET_READER');

const repoDiscovery: RepoDiscoveryDeps = {
  hasGitDir(dir: string): boolean {
    const candidate = join(dir, '.git');
    if (!existsSync(candidate)) return false;
    try {
      return statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  },
};

/**
 * Production reader. An unpinned request reads the working-tree file; a pinned
 * request (`gitSha` set) reads the blob at that commit so the snippet's line
 * numbers — computed against the pin — line up with the displayed text
 * (otherwise a working-tree checkout that differs from the pin mis-highlights;
 * see ADR-0029 / ADR-0032). The repo root is discovered by walking up from the
 * file for a `.git`; if none is found we report `missing` rather than serve the
 * mis-aligned working tree.
 */
export function createDefaultSnippetReader(
  gitPort: GitPort = new GitCliPort(),
): SnippetReader {
  return {
    readByFocalRanges: (file, ranges, context, gitSha) => {
      if (gitSha === undefined) {
        return readSourceSnippets(file, ranges, context);
      }
      const discovery = discoverRepoRoot(
        { glob: file, configDir: dirname(file) },
        repoDiscovery,
      );
      if (discovery.isErr()) {
        return Promise.resolve(
          ranges.map(() => ({ kind: 'unavailable', reason: 'missing' })),
        );
      }
      const repoRoot = discovery.value;
      return readGitFileSnippets(
        gitPort,
        repoRoot,
        gitSha,
        relative(repoRoot, file),
        ranges,
        context,
      );
    },
  };
}

const RANGE_SPEC = /^([1-9][0-9]*)(?:-([1-9][0-9]*))?$/;

@Injectable()
export class SnippetService {
  constructor(
    @Inject(SNIPPET_READER) private readonly reader: SnippetReader,
  ) {}

  readSnippets(req: ReadSnippetsRequest): ResultAsync<ReadSnippetsOk, SnippetError> {
    const parsed = parseRangeSpecs(req.rangeSpecs);
    if (parsed.err !== undefined) return errAsync(parsed.err);

    return ResultAsync.fromSafePromise(
      this.reader.readByFocalRanges(
        req.file,
        parsed.ranges,
        req.context,
        req.gitSha,
      ),
    ).andThen((results) => {
      const mapped = mapReaderResults(results, req.rangeSpecs, req.file);
      if (mapped.err !== undefined) return errAsync(mapped.err);
      return okAsync({ snippets: mapped.snippets });
    });
  }
}

function parseRangeSpecs(
  specs: ReadonlyArray<string>,
): { ranges: FocalRange[]; err?: undefined } | { err: SnippetError; ranges?: undefined } {
  const ranges: FocalRange[] = [];
  for (const spec of specs) {
    const m = RANGE_SPEC.exec(spec);
    if (m === null) {
      return { err: { kind: 'range-malformed', spec, reason: 'shape' } };
    }
    const focalStart = Number(m[1]);
    const focalEnd = m[2] === undefined ? focalStart : Number(m[2]);
    if (focalEnd < focalStart) {
      return { err: { kind: 'range-malformed', spec, reason: 'end-before-start' } };
    }
    ranges.push({ focalStart, focalEnd });
  }
  return { ranges };
}

function mapReaderResults(
  results: ReadonlyArray<SnippetReadResult>,
  specs: ReadonlyArray<string>,
  file: string,
):
  | { snippets: SourceSnippet[]; err?: undefined }
  | { err: SnippetError; snippets?: undefined } {
  const snippets: SourceSnippet[] = [];
  for (let i = 0; i < results.length; i++) {
    const entry = results[i];
    if (entry.kind === 'snippet') {
      snippets.push(entry);
      continue;
    }
    if (entry.reason === 'missing' || entry.reason === 'not-a-file') {
      return { err: { kind: 'file-read', file, reason: entry.reason } };
    }
    return { err: { kind: 'range-out-of-bounds', spec: specs[i] ?? '' } };
  }
  return { snippets };
}
