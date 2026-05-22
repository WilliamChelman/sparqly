import { describe, expect, it } from 'vitest';
import { validateProjectConfig } from './project-config-schema';

describe('validateProjectConfig — savedQueries block', () => {
  it('accepts a savedQueries block with a path', () => {
    const result = validateProjectConfig({
      sources: ['data/*.ttl'],
      savedQueries: { path: 'shared/.queries.yaml' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.savedQueries?.path).toBe('shared/.queries.yaml');
    }
  });

  it('accepts an empty savedQueries block', () => {
    const result = validateProjectConfig({
      sources: ['data/*.ttl'],
      savedQueries: {},
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown field under savedQueries', () => {
    const result = validateProjectConfig({
      sources: ['data/*.ttl'],
      savedQueries: { unknown: 1 },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string path', () => {
    const result = validateProjectConfig({
      sources: ['data/*.ttl'],
      savedQueries: { path: 42 },
    });
    expect(result.ok).toBe(false);
  });
});

describe('validateProjectConfig — index block', () => {
  it('accepts an index block with a dir overriding the Glob index cache root', () => {
    const result = validateProjectConfig({
      sources: ['data/*.ttl'],
      index: { dir: '/mnt/big-volume/sparqly-index' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.index?.dir).toBe('/mnt/big-volume/sparqly-index');
    }
  });

  it('accepts an empty index block', () => {
    const result = validateProjectConfig({
      sources: ['data/*.ttl'],
      index: {},
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown field under index', () => {
    const result = validateProjectConfig({
      sources: ['data/*.ttl'],
      index: { unknown: 1 },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string dir', () => {
    const result = validateProjectConfig({
      sources: ['data/*.ttl'],
      index: { dir: 42 },
    });
    expect(result.ok).toBe(false);
  });

  it('accepts an index block with a build concurrency cap', () => {
    const result = validateProjectConfig({
      sources: ['data/*.ttl'],
      index: { concurrency: 4 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.index?.concurrency).toBe(4);
    }
  });

  it('rejects a non-positive-integer concurrency', () => {
    for (const concurrency of [0, -1, 2.5]) {
      const result = validateProjectConfig({
        sources: ['data/*.ttl'],
        index: { concurrency },
      });
      expect(result.ok).toBe(false);
    }
  });
});
