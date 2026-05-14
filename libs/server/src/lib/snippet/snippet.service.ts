import { Inject, Injectable } from '@nestjs/common';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import {
  readSourceSnippets,
  type FocalRange,
  type SnippetReadResult,
  type SourceSnippet,
} from 'core';
import type { SnippetError } from './errors';

export interface ReadSnippetsRequest {
  file: string;
  rangeSpecs: ReadonlyArray<string>;
  context: number;
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
  ): Promise<SnippetReadResult[]>;
}

export const SNIPPET_READER = Symbol('SNIPPET_READER');

export function createDefaultSnippetReader(): SnippetReader {
  return {
    readByFocalRanges: (file, ranges, context) =>
      readSourceSnippets(file, ranges, context),
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
      this.reader.readByFocalRanges(req.file, parsed.ranges, req.context),
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
