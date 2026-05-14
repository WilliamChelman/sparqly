import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mapDiffHttpError } from './diff-http-errors';

describe('mapDiffHttpError', () => {
  it('maps unknown-source-id to 400 with structured body carrying side, id, availableIds', () => {
    const ex = mapDiffHttpError({
      kind: 'unknown-source-id',
      side: 'left',
      id: 'nope',
      availableIds: ['alpha', 'beta'],
    });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(ex.getResponse()).toEqual({
      kind: 'unknown-source-id',
      side: 'left',
      id: 'nope',
      availableIds: ['alpha', 'beta'],
    });
  });

  it('maps anonymous-view-execution to 502 with structured body carrying side and message', () => {
    const ex = mapDiffHttpError({
      kind: 'anonymous-view-execution',
      side: 'right',
      message: 'boom',
    });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(ex.getResponse()).toEqual({
      kind: 'anonymous-view-execution',
      side: 'right',
      message: 'boom',
    });
  });

  it('maps anonymous-select-execution to 502 with structured body carrying side and message', () => {
    const ex = mapDiffHttpError({
      kind: 'anonymous-select-execution',
      side: 'left',
      message: 'no socket',
    });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(ex.getResponse()).toEqual({
      kind: 'anonymous-select-execution',
      side: 'left',
      message: 'no socket',
    });
  });

  it('maps source-wrapped reference-target to 500 carrying the side', () => {
    const ex = mapDiffHttpError({
      kind: 'source',
      side: 'left',
      source: { kind: 'reference-target' },
    });
    expect(ex.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(ex.getResponse()).toEqual({
      kind: 'source',
      side: 'left',
      source: { kind: 'reference-target' },
    });
  });

  it('maps source-wrapped transform-parse to 500 carrying transform-key + message', () => {
    const ex = mapDiffHttpError({
      kind: 'source',
      side: 'right',
      source: {
        kind: 'transform-parse',
        transformKey: 'graphName',
        message: 'unknown mode "bogus"',
      },
    });
    expect(ex.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(ex.getResponse()).toEqual({
      kind: 'source',
      side: 'right',
      source: {
        kind: 'transform-parse',
        transformKey: 'graphName',
        message: 'unknown mode "bogus"',
      },
    });
  });
});
