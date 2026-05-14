import { describe, expect, it } from 'vitest';
import type {
  FocalRange,
  SnippetReadResult,
  SourceSnippet,
} from 'core';
import { SnippetService, type SnippetReader } from './snippet.service';

function fakeReader(
  fn: (
    file: string,
    ranges: ReadonlyArray<FocalRange>,
    context: number,
  ) => SnippetReadResult[],
): SnippetReader {
  return {
    readByFocalRanges: async (file, ranges, context) => fn(file, ranges, context),
  };
}

const SAMPLE_SNIPPET: SourceSnippet = {
  kind: 'snippet',
  startLine: 2,
  focalStart: 3,
  focalEnd: 3,
  lines: ['a', 'b', 'c'],
};

describe('SnippetService.readSnippets', () => {
  it('errs with range-malformed quoting the offending spec when shape is not <line> or <start>-<end>', async () => {
    const service = new SnippetService(
      fakeReader(() => {
        throw new Error('reader must not be called when ranges are malformed');
      }),
    );

    const result = await service.readSnippets({
      file: '/abs/data.ttl',
      rangeSpecs: ['banana'],
      context: 0,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual({
        kind: 'range-malformed',
        spec: 'banana',
        reason: 'shape',
      });
    }
  });

  it('errs with range-malformed/end-before-start when "<start>-<end>" has end < start', async () => {
    const service = new SnippetService(
      fakeReader(() => {
        throw new Error('reader must not be called when ranges are malformed');
      }),
    );

    const result = await service.readSnippets({
      file: '/abs/data.ttl',
      rangeSpecs: ['5-3'],
      context: 0,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual({
        kind: 'range-malformed',
        spec: '5-3',
        reason: 'end-before-start',
      });
    }
  });

  it('errs with file-read carrying file path and reason when reader reports the file is missing', async () => {
    const service = new SnippetService(
      fakeReader(() => [{ kind: 'unavailable', reason: 'missing' }]),
    );

    const result = await service.readSnippets({
      file: '/abs/gone.ttl',
      rangeSpecs: ['3'],
      context: 0,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual({
        kind: 'file-read',
        file: '/abs/gone.ttl',
        reason: 'missing',
      });
    }
  });

  it('errs with file-read/not-a-file when reader reports the path is a directory', async () => {
    const service = new SnippetService(
      fakeReader(() => [{ kind: 'unavailable', reason: 'not-a-file' }]),
    );

    const result = await service.readSnippets({
      file: '/abs/dir',
      rangeSpecs: ['3'],
      context: 0,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual({
        kind: 'file-read',
        file: '/abs/dir',
        reason: 'not-a-file',
      });
    }
  });

  it('errs with range-out-of-bounds quoting the offending spec when reader reports beyond-eof for any entry', async () => {
    const service = new SnippetService(
      fakeReader(() => [SAMPLE_SNIPPET, { kind: 'unavailable', reason: 'beyond-eof' }]),
    );

    const result = await service.readSnippets({
      file: '/abs/data.ttl',
      rangeSpecs: ['3', '999'],
      context: 0,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual({
        kind: 'range-out-of-bounds',
        spec: '999',
      });
    }
  });

  it('parses single-line range and returns snippets on the ok branch', async () => {
    let calledWith:
      | { file: string; ranges: ReadonlyArray<FocalRange>; context: number }
      | undefined;
    const service = new SnippetService(
      fakeReader((file, ranges, context) => {
        calledWith = { file, ranges, context };
        return [SAMPLE_SNIPPET];
      }),
    );

    const result = await service.readSnippets({
      file: '/abs/data.ttl',
      rangeSpecs: ['3'],
      context: 1,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.snippets).toEqual([SAMPLE_SNIPPET]);
    }
    expect(calledWith).toEqual({
      file: '/abs/data.ttl',
      ranges: [{ focalStart: 3, focalEnd: 3 }],
      context: 1,
    });
  });
});
