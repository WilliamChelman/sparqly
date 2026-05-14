import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mapDescribeHttpError } from './describe-http-errors';

describe('mapDescribeHttpError', () => {
  it('maps all-sources-failed to 502 with the structured per-source error map as the body', () => {
    const ex = mapDescribeHttpError({
      kind: 'all-sources-failed',
      perSource: {
        alpha: {
          kind: 'endpoint-describe',
          endpoint: 'http://ex/sparql',
          message: 'down',
        },
      },
    });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(ex.getResponse()).toEqual({
      kind: 'all-sources-failed',
      perSource: {
        alpha: {
          kind: 'endpoint-describe',
          endpoint: 'http://ex/sparql',
          message: 'down',
        },
      },
    });
  });

  it('maps empty-target to 400', () => {
    const ex = mapDescribeHttpError({ kind: 'empty-target' });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(ex.getResponse()).toEqual({ kind: 'empty-target' });
  });

  it('maps seed-not-iri to 400 carrying the offending value', () => {
    const ex = mapDescribeHttpError({
      kind: 'seed-not-iri',
      value: 'not-an-iri',
    });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(ex.getResponse()).toEqual({
      kind: 'seed-not-iri',
      value: 'not-an-iri',
    });
  });

  it('maps reference-target to 400', () => {
    const ex = mapDescribeHttpError({ kind: 'reference-target' });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(ex.getResponse()).toEqual({ kind: 'reference-target' });
  });
});
