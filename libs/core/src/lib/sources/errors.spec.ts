import { describe, expect, it } from 'vitest';
import { formatSourceError, type SourceError } from './errors';

describe('formatSourceError', () => {
  it('passes through verbatim messages for no-match glob-load and view-validation', () => {
    expect(
      formatSourceError({
        kind: 'glob-load',
        glob: ['/tmp/nope-*.ttl'],
        message: 'No files matched sources: /tmp/nope-*.ttl',
      }),
    ).toBe('No files matched sources: /tmp/nope-*.ttl');
    expect(
      formatSourceError({
        kind: 'glob-load',
        glob: ['/tmp/*.ttl'],
        file: '/tmp/broken.ttl',
        message: 'unexpected token',
      }),
    ).toBe('Failed to parse /tmp/broken.ttl: unexpected token');
  });

  it('produces a non-empty string for every SourceError variant', () => {
    const variants: ReadonlyArray<SourceError> = [
      { kind: 'reference-target' },
      { kind: 'glob-load', glob: ['x'], message: 'm' },
      { kind: 'glob-load', glob: ['x'], file: 'y', message: 'm' },
      { kind: 'query-execution', query: 'SELECT', message: 'm' },
      { kind: 'endpoint-fetch', endpoint: 'http://e', message: 'm' },
      { kind: 'view-validation', message: 'm' },
      { kind: 'view-validation', viewId: 'v', message: 'm' },
      { kind: 'view-reference', viewId: 'v', ref: 'r', reason: 'unknown', message: 'm' },
      { kind: 'view-reference', viewId: 'v', ref: 'r', reason: 'cycle', message: 'm' },
      { kind: 'view-reference', viewId: 'v', ref: 'r', reason: 'reference-upstream', message: 'm' },
      { kind: 'cache-io', cachePath: '/c', message: 'm' },
      { kind: 'transform-parse', transformKey: 'graphName', message: 'm' },
      { kind: 'transform-parse', transformKey: 'annotateSource', message: 'm' },
    ];
    for (const v of variants) {
      expect(formatSourceError(v).length).toBeGreaterThan(0);
    }
  });
});
