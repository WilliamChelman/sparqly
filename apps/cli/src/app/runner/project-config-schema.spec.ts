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
