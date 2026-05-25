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
      {
        kind: 'raw-pass-through-target',
        source: { kind: 'endpoint', url: 'http://e' },
        message: 'm',
      },
      {
        kind: 'raw-pass-through-target',
        source: { kind: 'disk-backed-glob', label: '@data' },
        message: 'm',
      },
    ];
    for (const v of variants) {
      expect(formatSourceError(v).length).toBeGreaterThan(0);
    }
  });

  it('formats the raw-pass-through-target variant verbatim from its `message` field', () => {
    expect(
      formatSourceError({
        kind: 'raw-pass-through-target',
        source: { kind: 'endpoint', url: 'http://e' },
        message: 'precomposed message',
      }),
    ).toBe('precomposed message');
  });
});

describe('formatRawPassThroughRejection', () => {
  it('names the endpoint URL and lists the three affordances (wrap-in-view, --query/--query-file, pipe sparqly query --format=turtle)', async () => {
    const { formatRawPassThroughRejection } = await import('./errors');
    const text = formatRawPassThroughRejection({
      kind: 'endpoint',
      url: 'https://example.org/sparql',
    });
    expect(text).toContain('https://example.org/sparql');
    expect(text).toMatch(/endpoint/i);
    expect(text).toMatch(/wrap.*view/i);
    expect(text).toMatch(/--query/);
    expect(text).toMatch(/--query-file/);
    expect(text).toMatch(/sparqly query --format=turtle/);
  });

  it('names the disk-backed glob label and lists the same three affordances', async () => {
    const { formatRawPassThroughRejection } = await import('./errors');
    const text = formatRawPassThroughRejection({
      kind: 'disk-backed-glob',
      label: '@data',
    });
    expect(text).toContain('@data');
    expect(text).toMatch(/disk-backed glob/i);
    expect(text).toMatch(/wrap.*view/i);
    expect(text).toMatch(/--query/);
    expect(text).toMatch(/--query-file/);
    expect(text).toMatch(/sparqly query --format=turtle/);
  });
});
