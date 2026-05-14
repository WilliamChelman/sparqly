import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { SourceError } from 'core';
import { sourceErrorToStatus } from './source-http-errors';

describe('sourceErrorToStatus — per-variant status mapping for SourceError', () => {
  const cases: Array<{ name: string; error: SourceError; status: HttpStatus }> = [
    {
      name: 'reference-target',
      error: { kind: 'reference-target' },
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    },
    {
      name: 'glob-load',
      error: {
        kind: 'glob-load',
        glob: ['/tmp/*.ttl'],
        message: 'no files matched',
      },
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    },
    {
      name: 'query-execution',
      error: { kind: 'query-execution', query: 'SELECT', message: 'parse failed' },
      status: HttpStatus.BAD_GATEWAY,
    },
    {
      name: 'endpoint-fetch',
      error: {
        kind: 'endpoint-fetch',
        endpoint: 'http://example.org/sparql',
        message: 'ECONNREFUSED',
      },
      status: HttpStatus.BAD_GATEWAY,
    },
    {
      name: 'view-validation',
      error: { kind: 'view-validation', message: 'projection mismatch' },
      status: HttpStatus.BAD_REQUEST,
    },
    {
      name: 'view-reference',
      error: {
        kind: 'view-reference',
        viewId: 'v',
        ref: 'r',
        reason: 'unknown',
        message: 'unknown @id',
      },
      status: HttpStatus.BAD_REQUEST,
    },
    {
      name: 'cache-io',
      error: { kind: 'cache-io', cachePath: '/c', message: 'EACCES' },
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    },
    {
      name: 'transform-parse',
      error: {
        kind: 'transform-parse',
        transformKey: 'graphName',
        message: 'unknown mode "bogus"',
      },
      status: HttpStatus.BAD_REQUEST,
    },
  ];

  for (const { name, error, status } of cases) {
    it(`maps ${name} to ${status}`, () => {
      expect(sourceErrorToStatus(error)).toBe(status);
    });
  }

  it('covers every variant of SourceError (compile-time exhaustiveness sanity)', () => {
    expect(cases.length).toBe(8);
  });
});
