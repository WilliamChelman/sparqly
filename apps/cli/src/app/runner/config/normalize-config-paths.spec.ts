import { describe, expect, it } from 'vitest';
import { normalizeConfigPaths } from './normalize-config-paths';

describe('normalizeConfigPaths — idempotence', () => {
  it('preserves already-absolute paths verbatim', () => {
    const out = normalizeConfigPaths(
      {
        index: { dir: '/etc/sparqly/index' },
        sources: [
          { id: 'data', glob: '/var/data/**/*.ttl' },
          { id: 'remote', endpoint: 'https://example.com/sparql' },
        ],
      },
      '/home/me/proj',
    );
    expect(out).toEqual({
      index: { dir: '/etc/sparqly/index' },
      sources: [
        { id: 'data', glob: '/var/data/**/*.ttl' },
        { id: 'remote', endpoint: 'https://example.com/sparql' },
      ],
    });
  });

  it('is idempotent: a second pass produces the same output as the first', () => {
    const input = {
      index: { dir: '.sparqly-index' },
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
          { id: 'docs', glob: '/abs/data/**/*.ttl', splitByFile: true },
        ],
      },
      '/home/me/proj',
    );
    expect(out).toEqual({
      serve: { port: 3000, watch: true },
      format: { prefixes: { ex: 'http://example.org/' } },
      sources: [
        { id: 'fedlex', endpoint: 'https://fedlex.data.admin.ch/sparqlendpoint' },
        { id: 'docs', glob: '/abs/data/**/*.ttl', splitByFile: true },
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
      index: { dir: '.sparqly-index' },
      sources: [{ id: 'data', glob: 'data/**/*.ttl' }],
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    normalizeConfigPaths(input, '/home/me/proj');
    expect(input).toEqual(snapshot);
  });
});

describe('normalizeConfigPaths — non-path values surfaced cleanly', () => {
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

});

describe('normalizeConfigPaths — index block', () => {
  it('absolutizes a relative index.dir against configDir', () => {
    const out = normalizeConfigPaths(
      { index: { dir: '.sparqly-index' } },
      '/home/me/proj',
    );
    expect(out).toEqual({ index: { dir: '/home/me/proj/.sparqly-index' } });
  });

  it('preserves an already-absolute index.dir verbatim', () => {
    const out = normalizeConfigPaths(
      { index: { dir: '/mnt/big-volume/sparqly-index' } },
      '/home/me/proj',
    );
    expect(out).toEqual({ index: { dir: '/mnt/big-volume/sparqly-index' } });
  });

  it('leaves a non-string index.dir as-is for the validator', () => {
    const out = normalizeConfigPaths(
      { index: { dir: 42 as unknown as string } },
      '/home/me/proj',
    );
    expect(out).toEqual({ index: { dir: 42 } });
  });
});
