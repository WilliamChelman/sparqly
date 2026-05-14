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

  it('formats legacy-message by passing the wrapped message through verbatim', () => {
    expect(
      formatSourceError({ kind: 'legacy-message', message: 'boom' }),
    ).toBe('boom');
  });

  it('produces a non-empty string for every SourceError variant', () => {
    const variants: ReadonlyArray<SourceError> = [
      { kind: 'reference-target' },
      { kind: 'glob-load', glob: ['x'], message: 'm' },
      { kind: 'glob-load', glob: ['x'], file: 'y', message: 'm' },
      { kind: 'query-execution', query: 'SELECT', message: 'm' },
      { kind: 'endpoint-fetch', endpoint: 'http://e', message: 'm' },
      { kind: 'legacy-message', message: 'm' },
    ];
    for (const v of variants) {
      expect(formatSourceError(v).length).toBeGreaterThan(0);
    }
  });
});
