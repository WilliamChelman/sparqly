import { describe, expect, it } from 'vitest';
import { formatSourceError, type SourceError } from './errors';

describe('formatSourceError', () => {
  it('formats reference-target with the legacy thrown wording', () => {
    expect(formatSourceError({ kind: 'reference-target' })).toBe(
      "resolveSource: `kind: 'reference'` entries are aliases, not data, and cannot be resolved as a target",
    );
  });

  it('passes the wrapped message through verbatim for a no-file glob-load (no-match path)', () => {
    const message = formatSourceError({
      kind: 'glob-load',
      glob: ['/tmp/nope-*.ttl'],
      message: 'No files matched sources: /tmp/nope-*.ttl',
    });
    expect(message).toBe('No files matched sources: /tmp/nope-*.ttl');
  });

  it('prefixes "Failed to parse <file>" when a glob-load attributes the failure to a file', () => {
    const message = formatSourceError({
      kind: 'glob-load',
      glob: ['/tmp/*.ttl'],
      file: '/tmp/broken.ttl',
      message: 'unexpected token',
    });
    expect(message).toBe('Failed to parse /tmp/broken.ttl: unexpected token');
  });

  it('formats query-execution wrapping the underlying message', () => {
    const message = formatSourceError({
      kind: 'query-execution',
      query: 'SELECT ?s WHERE { ?s ?p',
      message: 'parse failed at line 1',
    });
    expect(message).toMatch(/query execution failed/);
    expect(message).toMatch(/parse failed at line 1/);
  });

  it('formats endpoint-fetch naming the endpoint URL and the underlying reason', () => {
    const message = formatSourceError({
      kind: 'endpoint-fetch',
      endpoint: 'http://example.org/sparql',
      message: 'ECONNREFUSED',
    });
    expect(message).toMatch(/http:\/\/example\.org\/sparql/);
    expect(message).toMatch(/ECONNREFUSED/);
  });

  it('formats transform-parse naming the transform key and wrapping the underlying message', () => {
    const message = formatSourceError({
      kind: 'transform-parse',
      transformKey: 'graphName',
      message: 'unknown mode "bogus"',
    });
    expect(message).toMatch(/graphName/);
    expect(message).toMatch(/unknown mode "bogus"/);
  });

  it('formats view-validation naming the view id and wrapping the underlying message', () => {
    const message = formatSourceError({
      kind: 'view-validation',
      viewId: 'kept',
      message: 'SELECT view query must project exactly {?s, ?p, ?o}.',
    });
    expect(message).toMatch(/view "kept"/);
    expect(message).toMatch(/project exactly/);
  });

  it('formats view-validation without a view id when the failure is on an anonymous view', () => {
    const message = formatSourceError({
      kind: 'view-validation',
      message: 'UPDATE queries are not allowed for a view query; use SELECT or CONSTRUCT.',
    });
    expect(message).toMatch(/UPDATE.*not allowed/i);
  });

  it('formats view-reference naming the view, the missing @id ref, and the reason', () => {
    const message = formatSourceError({
      kind: 'view-reference',
      viewId: 'kept',
      ref: 'nope',
      reason: 'unknown',
      message: 'unknown @id reference "@nope"; defined ids: @raw',
    });
    expect(message).toMatch(/view "kept"/);
    expect(message).toMatch(/@nope/);
  });

  it('formats cache-io naming the cache path and wrapping the underlying message', () => {
    const message = formatSourceError({
      kind: 'cache-io',
      cachePath: '/tmp/sparqly-cache/abc.nq',
      message: 'EACCES: permission denied',
    });
    expect(message).toMatch(/\/tmp\/sparqly-cache\/abc\.nq/);
    expect(message).toMatch(/EACCES/);
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
