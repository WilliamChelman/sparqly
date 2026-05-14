import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mapSnippetHttpError } from './snippet-http-errors';

describe('mapSnippetHttpError', () => {
  it('maps range-malformed to 400 with structured body carrying spec and reason', () => {
    const ex = mapSnippetHttpError({
      kind: 'range-malformed',
      spec: 'banana',
      reason: 'shape',
    });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(ex.getResponse()).toEqual({
      kind: 'range-malformed',
      spec: 'banana',
      reason: 'shape',
    });
  });

  it('maps range-out-of-bounds to 400 with structured body carrying spec', () => {
    const ex = mapSnippetHttpError({
      kind: 'range-out-of-bounds',
      spec: '999',
    });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(ex.getResponse()).toEqual({
      kind: 'range-out-of-bounds',
      spec: '999',
    });
  });

  it('maps file-read to 500 with structured body carrying file path and reason', () => {
    const ex = mapSnippetHttpError({
      kind: 'file-read',
      file: '/abs/gone.ttl',
      reason: 'missing',
    });
    expect(ex.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(ex.getResponse()).toEqual({
      kind: 'file-read',
      file: '/abs/gone.ttl',
      reason: 'missing',
    });
  });

  it('maps target/unknown-ref to 400 via targetErrorToStatus, with structured body carrying nested target', () => {
    const ex = mapSnippetHttpError({
      kind: 'target',
      target: {
        kind: 'unknown-ref',
        ref: '@nope',
        availableIds: ['alpha', 'beta'],
      },
    });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(ex.getResponse()).toEqual({
      kind: 'target',
      target: {
        kind: 'unknown-ref',
        ref: '@nope',
        availableIds: ['alpha', 'beta'],
      },
    });
  });

  it('maps target/ref-as-target to 400 via targetErrorToStatus', () => {
    const ex = mapSnippetHttpError({
      kind: 'target',
      target: { kind: 'ref-as-target' },
    });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(ex.getResponse()).toEqual({
      kind: 'target',
      target: { kind: 'ref-as-target' },
    });
  });
});
