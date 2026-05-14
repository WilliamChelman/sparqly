import { describe, expect, it } from 'vitest';
import {
  formatDescribeError,
  formatDescribePerSourceError,
} from './errors';

describe('formatDescribePerSourceError', () => {
  it('formats source by delegating to formatSourceError', () => {
    const message = formatDescribePerSourceError({
      kind: 'source',
      source: {
        kind: 'glob-load',
        glob: ['/tmp/*.ttl'],
        message: 'cannot read file foo.ttl',
      },
    });
    expect(message).toBe('cannot read file foo.ttl');
  });

  it('formats endpoint-describe naming the endpoint URL and wrapped message', () => {
    const message = formatDescribePerSourceError({
      kind: 'endpoint-describe',
      endpoint: 'https://ex.org/sparql',
      message: 'HTTP 502 Bad Gateway',
    });
    expect(message).toMatch(/https:\/\/ex\.org\/sparql/);
    expect(message).toMatch(/HTTP 502/);
  });

  it('formats empty-source naming the source id and pointing at a scoping view', () => {
    const message = formatDescribePerSourceError({
      kind: 'empty-source',
      id: 'placeholder',
    });
    expect(message).toMatch(/placeholder/);
    expect(message).toMatch(/empty source/i);
    expect(message).toMatch(/view/);
  });

  it('formats reference-source naming the id and the ref it aliases', () => {
    const message = formatDescribePerSourceError({
      kind: 'reference-source',
      id: 'aliasy',
      ref: 'alpha',
    });
    expect(message).toMatch(/aliasy/);
    expect(message).toMatch(/reference/i);
    expect(message).toMatch(/alpha/);
  });
});

describe('formatDescribeError', () => {
  it('formats all-sources-failed listing the failing source ids sorted with @ prefix', () => {
    const message = formatDescribeError({
      kind: 'all-sources-failed',
      perSource: {
        beta: { kind: 'endpoint-describe', endpoint: 'x', message: 'y' },
        alpha: { kind: 'endpoint-describe', endpoint: 'x', message: 'y' },
      },
    });
    expect(message).toMatch(/every selected source failed/i);
    expect(message).toMatch(/@alpha.*@beta/);
  });

  it('formats empty-target with describe context', () => {
    const message = formatDescribeError({ kind: 'empty-target' });
    expect(message).toMatch(/describe/);
    expect(message).toMatch(/no target sources/i);
  });

  it('formats seed-not-iri carrying the offending value', () => {
    const message = formatDescribeError({
      kind: 'seed-not-iri',
      value: 'not-an-iri',
    });
    expect(message).toMatch(/not-an-iri/);
    expect(message).toMatch(/iri/i);
  });

  it('formats reference-target explaining no real data source was selected', () => {
    const message = formatDescribeError({ kind: 'reference-target' });
    expect(message).toMatch(/reference/i);
    expect(message).toMatch(/describe/i);
  });
});
