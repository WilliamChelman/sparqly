import { describe, expect, it } from 'vitest';
import { normalizeConfigPaths } from './normalize-config-paths';

describe('normalizeConfigPaths — tracer bullet', () => {
  it('absolutizes a relative cache.dir against configDir', () => {
    const out = normalizeConfigPaths(
      { cache: { dir: '.sparqly-cache' } },
      '/home/me/proj',
    );
    expect(out).toEqual({ cache: { dir: '/home/me/proj/.sparqly-cache' } });
  });
});

describe('normalizeConfigPaths — idempotence', () => {
  it('preserves already-absolute paths verbatim', () => {
    const out = normalizeConfigPaths(
      {
        cache: { dir: '/etc/sparqly/cache' },
        sources: [
          { id: 'data', glob: '/var/data/**/*.ttl' },
          { id: 'view', from: '@data', queryFile: '/srv/queries/scope.rq' },
        ],
      },
      '/home/me/proj',
    );
    expect(out).toEqual({
      cache: { dir: '/etc/sparqly/cache' },
      sources: [
        { id: 'data', glob: '/var/data/**/*.ttl' },
        { id: 'view', from: '@data', queryFile: '/srv/queries/scope.rq' },
      ],
    });
  });

  it('is idempotent: a second pass produces the same output as the first', () => {
    const input = {
      cache: { dir: '.sparqly-cache' },
      sources: [{ id: 'data', glob: 'data/**/*.ttl' }],
    };
    const once = normalizeConfigPaths(input, '/home/me/proj');
    const twice = normalizeConfigPaths(once, '/home/me/proj');
    expect(twice).toEqual(once);
  });
});

describe('normalizeConfigPaths — non-path data untouched', () => {
  it('leaves serve, format, and non-path source fields unchanged', () => {
    const out = normalizeConfigPaths(
      {
        serve: { port: 3000, watch: true },
        format: { prefixes: { ex: 'http://example.org/' } },
        sources: [
          { id: 'fedlex', endpoint: 'https://fedlex.data.admin.ch/sparqlendpoint' },
          { id: 'view', from: '@fedlex', query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }' },
        ],
      },
      '/home/me/proj',
    );
    expect(out).toEqual({
      serve: { port: 3000, watch: true },
      format: { prefixes: { ex: 'http://example.org/' } },
      sources: [
        { id: 'fedlex', endpoint: 'https://fedlex.data.admin.ch/sparqlendpoint' },
        { id: 'view', from: '@fedlex', query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }' },
      ],
    });
  });

  it('passes through bare-string sources[] entries (out of scope per ADR-0010)', () => {
    const out = normalizeConfigPaths(
      { sources: ['https://example.com/sparql', '@my-ref'] },
      '/home/me/proj',
    );
    expect(out).toEqual({
      sources: ['https://example.com/sparql', '@my-ref'],
    });
  });

  it('does not mutate the input object or its nested structures', () => {
    const input: Record<string, unknown> = {
      cache: { dir: '.sparqly-cache' },
      sources: [{ id: 'data', glob: 'data/**/*.ttl' }],
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    normalizeConfigPaths(input, '/home/me/proj');
    expect(input).toEqual(snapshot);
  });
});

describe('normalizeConfigPaths — non-path values surfaced cleanly', () => {
  it('leaves a non-string cache.dir as-is for the validator', () => {
    const out = normalizeConfigPaths(
      { cache: { dir: 42 as unknown as string } },
      '/home/me/proj',
    );
    expect(out).toEqual({ cache: { dir: 42 } });
  });

  it('leaves a non-string sources[].glob as-is for the validator', () => {
    const out = normalizeConfigPaths(
      { sources: [{ id: 'data', glob: 123 as unknown as string }] },
      '/home/me/proj',
    );
    expect(out).toEqual({ sources: [{ id: 'data', glob: 123 }] });
  });
});

describe('normalizeConfigPaths — sources[] path keys', () => {
  it('absolutizes a relative glob on a sources[] entry against configDir', () => {
    const out = normalizeConfigPaths(
      { sources: [{ id: 'data', glob: 'data/**/*.ttl' }] },
      '/home/me/proj',
    );
    expect(out).toEqual({
      sources: [{ id: 'data', glob: '/home/me/proj/data/**/*.ttl' }],
    });
  });

  it('absolutizes a relative queryFile on a sources[] entry against configDir', () => {
    const out = normalizeConfigPaths(
      { sources: [{ id: 'view', from: '@data', queryFile: 'queries/scope.rq' }] },
      '/home/me/proj',
    );
    expect(out).toEqual({
      sources: [
        { id: 'view', from: '@data', queryFile: '/home/me/proj/queries/scope.rq' },
      ],
    });
  });
});
