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

describe('validateProjectConfig — query block', () => {
  it('accepts a query block with a worker-pool concurrency cap', () => {
    const result = validateProjectConfig({
      sources: ['data/*.ttl'],
      query: { concurrency: 3 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.query?.concurrency).toBe(3);
    }
  });

  it('accepts a query block with a per-worker resident-quad budget', () => {
    const result = validateProjectConfig({
      sources: ['data/*.ttl'],
      query: { maxResidentQuads: 1_000_000 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.query?.maxResidentQuads).toBe(1_000_000);
    }
  });

  it('rejects a non-positive-integer query maxResidentQuads', () => {
    for (const maxResidentQuads of [0, -1, 2.5]) {
      const result = validateProjectConfig({
        sources: ['data/*.ttl'],
        query: { maxResidentQuads },
      });
      expect(result.ok).toBe(false);
    }
  });

  it('accepts a query block with a per-worker old-generation OOM ceiling', () => {
    const result = validateProjectConfig({
      sources: ['data/*.ttl'],
      query: { maxOldGenerationSizeMb: 256 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.query?.maxOldGenerationSizeMb).toBe(256);
    }
  });

  it('rejects a non-positive-integer query maxOldGenerationSizeMb', () => {
    for (const maxOldGenerationSizeMb of [0, -1, 2.5]) {
      const result = validateProjectConfig({
        sources: ['data/*.ttl'],
        query: { maxOldGenerationSizeMb },
      });
      expect(result.ok).toBe(false);
    }
  });

  it('accepts an empty query block', () => {
    const result = validateProjectConfig({
      sources: ['data/*.ttl'],
      query: {},
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown field under query', () => {
    const result = validateProjectConfig({
      sources: ['data/*.ttl'],
      query: { unknown: 1 },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-positive-integer query concurrency', () => {
    for (const concurrency of [0, -1, 2.5]) {
      const result = validateProjectConfig({
        sources: ['data/*.ttl'],
        query: { concurrency },
      });
      expect(result.ok).toBe(false);
    }
  });

  it('still rejects a scalar query at root as a per-invocation flag', () => {
    const result = validateProjectConfig({
      sources: ['data/*.ttl'],
      query: 'SELECT * WHERE { ?s ?p ?o }',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0].message).toMatch(/per-invocation/);
    }
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

describe('validateProjectConfig — queryCache block', () => {
  it('resolves a human maxBytes / maxEntryBytes to a byte count', () => {
    const result = validateProjectConfig({
      sources: ['data/*.ttl'],
      queryCache: { maxBytes: '512MB', maxEntryBytes: '8MB' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.queryCache?.maxBytes).toBe(512 * 1024 * 1024);
      expect(result.data.queryCache?.maxEntryBytes).toBe(8 * 1024 * 1024);
    }
  });

  it('accepts a raw byte count and an explicit `null` (unbounded) maxBytes', () => {
    const raw = validateProjectConfig({
      sources: ['data/*.ttl'],
      queryCache: { maxBytes: 1024 },
    });
    expect(raw.ok).toBe(true);
    if (raw.ok) expect(raw.data.queryCache?.maxBytes).toBe(1024);

    const unbounded = validateProjectConfig({
      sources: ['data/*.ttl'],
      queryCache: { maxBytes: null },
    });
    expect(unbounded.ok).toBe(true);
    if (unbounded.ok) expect(unbounded.data.queryCache?.maxBytes).toBeNull();
  });

  it('accepts an empty queryCache block', () => {
    expect(
      validateProjectConfig({ sources: ['data/*.ttl'], queryCache: {} }).ok,
    ).toBe(true);
  });

  it('rejects an unparseable byte size and an unknown field', () => {
    expect(
      validateProjectConfig({
        sources: ['data/*.ttl'],
        queryCache: { maxBytes: 'enormous' },
      }).ok,
    ).toBe(false);
    expect(
      validateProjectConfig({
        sources: ['data/*.ttl'],
        queryCache: { unknown: 1 },
      }).ok,
    ).toBe(false);
  });
});

describe('validateProjectConfig — per-source queryCache', () => {
  it('accepts a per-source `queryCache: { ttl }` (ADR-0054, #416)', () => {
    const result = validateProjectConfig({
      sources: [{ endpoint: 'https://example.com/sparql', queryCache: { ttl: '30min' } }],
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a per-source `queryCache: { ttl, maxBytes }`', () => {
    const result = validateProjectConfig({
      sources: [
        {
          endpoint: 'https://example.com/sparql',
          queryCache: { ttl: '1h', maxBytes: 1024 },
        },
      ],
    });
    expect(result.ok).toBe(true);
  });
});
