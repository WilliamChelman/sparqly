import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mapDiffHttpError } from './diff-http-errors';

describe('mapDiffHttpError', () => {
  it('maps target/unknown-ref to 400 via targetErrorToStatus, with structured body carrying side and nested target', () => {
    const ex = mapDiffHttpError({
      kind: 'target',
      side: 'left',
      target: {
        kind: 'unknown-ref',
        ref: '@nope',
        availableIds: ['alpha', 'beta'],
      },
    });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(ex.getResponse()).toEqual({
      kind: 'target',
      side: 'left',
      target: {
        kind: 'unknown-ref',
        ref: '@nope',
        availableIds: ['alpha', 'beta'],
      },
    });
  });

  it('maps target/ref-as-target to 400 via targetErrorToStatus', () => {
    const ex = mapDiffHttpError({
      kind: 'target',
      side: 'right',
      target: { kind: 'ref-as-target' },
    });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(ex.getResponse()).toEqual({
      kind: 'target',
      side: 'right',
      target: { kind: 'ref-as-target' },
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
