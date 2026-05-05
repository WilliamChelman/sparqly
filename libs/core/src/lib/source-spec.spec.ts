import { describe, expect, it } from 'vitest';
import { parseSourceSpec, parseSourceSpecs } from './source-spec';
import type { TransformDefinition } from './transform-spec';

const STUB_NOOP: TransformDefinition = {
  key: 'stubNoop',
  parse: () => (s) => s,
};

describe('parseSourceSpec — string discriminator', () => {
  it('parses a plain string as a glob source', () => {
    const parsed = parseSourceSpec('data/*.ttl');
    expect(parsed).toEqual({ kind: 'glob', glob: 'data/*.ttl' });
  });

  it('parses an http(s) URL as an endpoint source', () => {
    expect(parseSourceSpec('https://example.com/sparql')).toEqual({
      kind: 'endpoint',
      endpoint: 'https://example.com/sparql',
    });
    expect(parseSourceSpec('http://example.com/sparql')).toEqual({
      kind: 'endpoint',
      endpoint: 'http://example.com/sparql',
    });
  });

  it('parses @id strings as references and strips the @ prefix', () => {
    expect(parseSourceSpec('@my-source')).toEqual({
      kind: 'reference',
      ref: 'my-source',
    });
  });
});

describe('parseSourceSpec — object form', () => {
  it('parses { glob } as a glob source', () => {
    expect(parseSourceSpec({ glob: 'data/*.ttl' })).toEqual({
      kind: 'glob',
      glob: 'data/*.ttl',
    });
  });

  it('preserves a literal @ in object-form glob paths (escape hatch for exotic paths)', () => {
    expect(parseSourceSpec({ glob: 'data/@archive/foo.ttl' })).toEqual({
      kind: 'glob',
      glob: 'data/@archive/foo.ttl',
    });
  });

  it('parses { endpoint } as an endpoint source', () => {
    expect(
      parseSourceSpec({ endpoint: 'https://example.com/sparql', id: 'live' }),
    ).toEqual({
      kind: 'endpoint',
      endpoint: 'https://example.com/sparql',
      id: 'live',
    });
  });

  it('carries through optional common fields on the glob branch', () => {
    expect(
      parseSourceSpec({
        glob: 'data/*.ttl',
        id: 'vocab',
      }),
    ).toEqual({
      kind: 'glob',
      glob: 'data/*.ttl',
      id: 'vocab',
    });
  });

  it('rejects an object with both glob: and endpoint:', () => {
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.ttl',
        endpoint: 'https://example.com/sparql',
      }),
    ).toThrow(/exactly one of `glob:`, `endpoint:`, `from:`, or `empty:`/);
  });

  it('rejects an object with no glob:, endpoint:, or from:', () => {
    expect(() => parseSourceSpec({ id: 'orphan' })).toThrow(
      /exactly one of `glob:`, `endpoint:`, `from:`, or `empty:`/,
    );
  });
});

describe('parseSourceSpec — empty source', () => {
  it('parses { id, empty: true } as a `kind: empty` source', () => {
    expect(parseSourceSpec({ id: 'composer', empty: true })).toEqual({
      kind: 'empty',
      id: 'composer',
    });
  });

  it('rejects empty: true combined with glob:', () => {
    expect(() =>
      parseSourceSpec({
        id: 'mix',
        // @ts-expect-error — empty: true is mutually exclusive with glob
        empty: true,
        glob: 'data/*.ttl',
      }),
    ).toThrow(
      /exactly one of `glob:`, `endpoint:`, `from:`, or `empty:`/,
    );
  });

  it('rejects empty: true combined with endpoint:', () => {
    expect(() =>
      parseSourceSpec({
        id: 'mix',
        // @ts-expect-error — empty: true is mutually exclusive with endpoint
        empty: true,
        endpoint: 'https://example.com/sparql',
      }),
    ).toThrow(
      /exactly one of `glob:`, `endpoint:`, `from:`, or `empty:`/,
    );
  });

  it('rejects empty: true combined with from:', () => {
    expect(() =>
      parseSourceSpec({
        id: 'mix',
        // @ts-expect-error — empty: true is mutually exclusive with from
        empty: true,
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      }),
    ).toThrow(
      /exactly one of `glob:`, `endpoint:`, `from:`, or `empty:`/,
    );
  });

  it('requires an id on empty sources', () => {
    expect(() =>
      // @ts-expect-error — id is required on empty sources
      parseSourceSpec({ empty: true }),
    ).toThrow(/empty source.*`id` is required/i);
  });

  it('rejects empty: false (must opt in with `true`)', () => {
    expect(() =>
      parseSourceSpec({
        id: 'composer',
        // @ts-expect-error — empty must be `true`
        empty: false,
      }),
    ).toThrow(
      /exactly one of `glob:`, `endpoint:`, `from:`, or `empty:`/,
    );
  });

  it('rejects unknown extra fields on an empty source', () => {
    expect(() =>
      parseSourceSpec({
        id: 'composer',
        empty: true,
        // @ts-expect-error — graphMode is glob-only
        graphMode: 'preserve',
      }),
    ).toThrow(/empty source/i);
  });

  it('treats `@empty` as a regular reference, not a magic empty-source string', () => {
    // No string shorthand for empty sources — object form only (per ADR-0004).
    expect(parseSourceSpec('@empty')).toEqual({
      kind: 'reference',
      ref: 'empty',
    });
  });
});

describe('parseSourceSpec — view discriminant', () => {
  it('parses a view with a single string from ref, an inline query, and an id', () => {
    expect(
      parseSourceSpec({
        id: 'filtered',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      }),
    ).toEqual({
      kind: 'view',
      id: 'filtered',
      from: 'raw',
      query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
    });
  });

  it('parses a view with queryFile instead of inline query', () => {
    expect(
      parseSourceSpec({
        id: 'filtered',
        from: '@raw',
        queryFile: './scope.rq',
      }),
    ).toEqual({
      kind: 'view',
      id: 'filtered',
      from: 'raw',
      queryFile: './scope.rq',
    });
  });

  it('rejects `from:` given as an array (any length) and points at SERVICE for composition', () => {
    expect(() =>
      parseSourceSpec({
        id: 'fanned',
        // @ts-expect-error — array form is no longer accepted
        from: ['@a', '@b'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      }),
    ).toThrow(/`from:`.*single.*ref.*SERVICE/i);
    expect(() =>
      parseSourceSpec({
        id: 'one-element',
        // @ts-expect-error — single-element arrays are also rejected
        from: ['@a'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      }),
    ).toThrow(/`from:`.*single.*ref.*SERVICE/i);
    expect(() =>
      parseSourceSpec({
        id: 'empty',
        // @ts-expect-error — empty arrays are also rejected
        from: [],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      }),
    ).toThrow(/`from:`.*single.*ref.*SERVICE/i);
  });

  it('rejects a view with both query and queryFile', () => {
    expect(() =>
      parseSourceSpec({
        id: 'filtered',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        queryFile: './scope.rq',
      }),
    ).toThrow(/`query`.*`queryFile`.*mutual/i);
  });

  it('rejects a view with neither query nor queryFile', () => {
    expect(() =>
      parseSourceSpec({
        id: 'filtered',
        from: '@raw',
      }),
    ).toThrow(/view.*exactly one of `query`.*`queryFile`/i);
  });

  it('rejects a view without an id', () => {
    expect(() =>
      parseSourceSpec({
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      }),
    ).toThrow(/view.*id.*required/i);
  });

  it('rejects a from value that is not a `@id` reference', () => {
    expect(() =>
      parseSourceSpec({
        id: 'filtered',
        from: 'raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      }),
    ).toThrow(/from.*ref.*@/i);
  });

  it('rejects a view that also declares glob:', () => {
    expect(() =>
      parseSourceSpec({
        id: 'mix',
        from: '@raw',
        glob: 'data/*.ttl',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      }),
    ).toThrow(/exactly one of `glob:`, `endpoint:`, `from:`, or `empty:`/);
  });

  it('rejects a view that also declares endpoint:', () => {
    expect(() =>
      parseSourceSpec({
        id: 'mix',
        from: '@raw',
        endpoint: 'https://example.org/sparql',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      }),
    ).toThrow(/exactly one of `glob:`, `endpoint:`, `from:`, or `empty:`/);
  });
});

describe('parseSourceSpec — view cache block', () => {
  it('parses a view with cache.ttl as a duration string', () => {
    expect(
      parseSourceSpec({
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h' },
      }),
    ).toEqual({
      kind: 'view',
      id: 'cached',
      from: 'raw',
      query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      cache: { strategy: 'ttl', ttlMs: 60 * 60 * 1000 },
    });
  });

  it('honours a per-view cacheDir override on the cache block', () => {
    expect(
      parseSourceSpec({
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '5m', cacheDir: './tmp/my-cache' },
      }),
    ).toMatchObject({
      cache: { strategy: 'ttl', ttlMs: 5 * 60 * 1000, cacheDir: './tmp/my-cache' },
    });
  });

  it('accepts ttl as a positive number of milliseconds', () => {
    expect(
      parseSourceSpec({
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: 1500 },
      }),
    ).toMatchObject({ cache: { strategy: 'ttl', ttlMs: 1500 } });
  });

  it('parses a freshness ASK probe as the cache strategy', () => {
    expect(
      parseSourceSpec({
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { freshness: 'ASK { ?s ?p ?o }' },
      }),
    ).toMatchObject({
      cache: { strategy: 'freshness', freshness: 'ASK { ?s ?p ?o }' },
    });
  });

  it('parses everlasting:true as the cache strategy', () => {
    expect(
      parseSourceSpec({
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { everlasting: true },
      }),
    ).toMatchObject({
      cache: { strategy: 'everlasting' },
    });
  });

  it('rejects a cache block declaring no strategy', () => {
    expect(() =>
      parseSourceSpec({
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        // @ts-expect-error — must declare exactly one strategy
        cache: {},
      }),
    ).toThrow(/cache.*exactly one.*ttl.*freshness.*everlasting/i);
  });

  it('rejects an unparseable ttl duration string', () => {
    expect(() =>
      parseSourceSpec({
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: 'forever' },
      }),
    ).toThrow(/cache.*ttl/i);
  });

  it('rejects ttl + freshness combined', () => {
    expect(() =>
      parseSourceSpec({
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h', freshness: 'ASK { ?s ?p ?o }' },
      }),
    ).toThrow(/cache.*exactly one.*ttl.*freshness.*everlasting/i);
  });

  it('rejects ttl + everlasting combined', () => {
    expect(() =>
      parseSourceSpec({
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { ttl: '1h', everlasting: true },
      }),
    ).toThrow(/cache.*exactly one.*ttl.*freshness.*everlasting/i);
  });

  it('rejects freshness + everlasting combined', () => {
    expect(() =>
      parseSourceSpec({
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { freshness: 'ASK { ?s ?p ?o }', everlasting: true },
      }),
    ).toThrow(/cache.*exactly one.*ttl.*freshness.*everlasting/i);
  });

  it('rejects everlasting:false (must be true to opt into the strategy)', () => {
    expect(() =>
      parseSourceSpec({
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { everlasting: false },
      }),
    ).toThrow(/everlasting.*true/i);
  });

  it('rejects an empty freshness ASK string', () => {
    expect(() =>
      parseSourceSpec({
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        cache: { freshness: '' },
      }),
    ).toThrow(/freshness.*non-empty/i);
  });

  it('rejects unknown keys on the cache block', () => {
    expect(() =>
      parseSourceSpec({
        id: 'cached',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        // @ts-expect-error — `bogus` is not a known cache key
        cache: { ttl: '1h', bogus: true },
      }),
    ).toThrow(/cache.*unknown.*bogus/i);
  });

  it('rejects a cache block on a non-view source (glob)', () => {
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.ttl',
        // @ts-expect-error — cache only valid on view sources
        cache: { ttl: '1h' },
      }),
    ).toThrow(/cache.*view/i);
  });

  it('rejects a cache block on an endpoint source', () => {
    expect(() =>
      parseSourceSpec({
        endpoint: 'https://example.org/sparql',
        // @ts-expect-error — cache only valid on view sources
        cache: { ttl: '1h' },
      }),
    ).toThrow(/cache.*view/i);
  });
});

describe('parseSourceSpec — top-level graph/graphMode are removed (alpha-stage breaking change)', () => {
  it('rejects an endpoint source carrying graphMode with a hint about views', () => {
    expect(() =>
      parseSourceSpec({
        endpoint: 'https://example.com/sparql',
        // @ts-expect-error — `graphMode` was removed from endpoint source-spec shape
        graphMode: 'forceAll',
      }),
    ).toThrow(/graphMode.*endpoint.*view/i);
  });

  it('rejects an endpoint source carrying graph with a hint about views', () => {
    expect(() =>
      parseSourceSpec({
        endpoint: 'https://example.com/sparql',
        // @ts-expect-error — `graph` was removed from endpoint source-spec shape
        graph: 'urn:my:custom-graph',
      }),
    ).toThrow(/\bgraph\b.*endpoint.*view/i);
  });

  it('rejects graphMode on a glob source with a stable error pointing at the transforms pipeline', () => {
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.ttl',
        // @ts-expect-error — `graphMode` was removed from glob source-spec shape
        graphMode: 'forceAll',
      }),
    ).toThrow(/graphMode.*removed.*transforms.*graphName/);
  });

  it('rejects graph on a glob source with a stable error pointing at the transforms pipeline', () => {
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.ttl',
        // @ts-expect-error — `graph` was removed from glob source-spec shape
        graph: 'urn:g',
      }),
    ).toThrow(/`graph`.*removed.*transforms.*graphName/);
  });
});

describe('parseSourceSpec — graphName transform on glob sources', () => {
  it('parses graphName shorthand into a registered transform', () => {
    const parsed = parseSourceSpec({
      glob: 'data/*.ttl',
      transforms: [{ graphName: 'forceAll' }],
    });
    expect(parsed.kind).toBe('glob');
    if (parsed.kind === 'glob') {
      expect(parsed.transforms).toHaveLength(1);
      expect(parsed.transforms?.[0].key).toBe('graphName');
    }
  });

  it('parses graphName long form with override IRI', () => {
    const parsed = parseSourceSpec({
      glob: 'data/*.ttl',
      transforms: [{ graphName: { mode: 'forceAll', graph: 'urn:g' } }],
    });
    expect(parsed.kind).toBe('glob');
    if (parsed.kind === 'glob') {
      expect(parsed.transforms?.[0].key).toBe('graphName');
    }
  });

  it('rejects override `graph` with mode `preserve`', () => {
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.ttl',
        transforms: [{ graphName: { mode: 'preserve', graph: 'urn:g' } }],
      }),
    ).toThrow(/graphName.*`graph`.*preserve/);
  });

  it('rejects override `graph` with mode `flatten`', () => {
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.ttl',
        transforms: [{ graphName: { mode: 'flatten', graph: 'urn:g' } }],
      }),
    ).toThrow(/graphName.*`graph`.*flatten/);
  });

  it('rejects an unknown graphName mode shorthand', () => {
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.ttl',
        // @ts-expect-error — invalid mode
        transforms: [{ graphName: 'bogus' }],
      }),
    ).toThrow(/graphName.*unknown mode "bogus"/);
  });
});

describe('parseSourceSpec — annotateSource transform on glob sources', () => {
  it('accepts annotateSource with no fields (defaults)', () => {
    const parsed = parseSourceSpec({
      glob: 'data/*.ttl',
      transforms: [{ annotateSource: {} }],
    });
    expect(parsed.kind).toBe('glob');
    if (parsed.kind === 'glob') {
      expect(parsed.transforms?.[0].key).toBe('annotateSource');
    }
  });

  it('accepts annotateSource: null as defaults', () => {
    const parsed = parseSourceSpec({
      glob: 'data/*.ttl',
      // @ts-expect-error — null collapses to defaults
      transforms: [{ annotateSource: null }],
    });
    expect(parsed.kind).toBe('glob');
    if (parsed.kind === 'glob') {
      expect(parsed.transforms?.[0].key).toBe('annotateSource');
    }
  });

  it('accepts each subset of source/file/line overrides', () => {
    for (const overrides of [
      { source: 'http://my/source' },
      { file: 'http://my/file' },
      { line: 'http://my/line' },
      {
        source: 'http://my/source',
        file: 'http://my/file',
        line: 'http://my/line',
      },
    ]) {
      expect(() =>
        parseSourceSpec({
          glob: 'data/*.ttl',
          transforms: [{ annotateSource: overrides }],
        }),
      ).not.toThrow();
    }
  });

  it('rejects unknown fields under annotateSource', () => {
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.ttl',
        // @ts-expect-error — unknown field
        transforms: [{ annotateSource: { bogus: 'x' } }],
      }),
    ).toThrow(/annotateSource.*unknown key.*bogus/);
  });

  it('rejects the legacy `annotate` key with a registry error that names `annotateSource`', () => {
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.ttl',
        // @ts-expect-error — legacy key removed in ADR-0008
        transforms: [{ annotate: {} }],
      }),
    ).toThrow(/unknown transform key "annotate".*annotateSource/);
  });
});

describe('parseSourceSpec — transforms field (closed registry)', () => {
  it('accepts an empty transforms list on a glob source and surfaces it as []', () => {
    const parsed = parseSourceSpec({ glob: 'data/*.ttl', transforms: [] });
    expect(parsed).toMatchObject({ kind: 'glob', glob: 'data/*.ttl', transforms: [] });
  });

  it('omits the transforms field on a glob source when it is not declared', () => {
    const parsed = parseSourceSpec({ glob: 'data/*.ttl' });
    expect((parsed as Record<string, unknown>).transforms).toBeUndefined();
  });

  it('rejects an unknown transform key with a stable error naming the key', () => {
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.ttl',
        // @ts-expect-error — unknown key in closed registry
        transforms: [{ bogus: 'forceAll' }],
      }),
    ).toThrow(/unknown transform key "bogus"/);
  });

  it('rejects a non-array transforms value', () => {
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.ttl',
        // @ts-expect-error — must be an array
        transforms: { stubNoop: true },
      }),
    ).toThrow(/`transforms` must be an array/);
  });

  it('accepts a registered transform via an injected stub registry', () => {
    const parsed = parseSourceSpec(
      { glob: 'data/*.ttl', transforms: [{ stubNoop: true }] },
      { transformRegistry: [STUB_NOOP] },
    );
    expect(parsed.kind).toBe('glob');
    if (parsed.kind === 'glob') {
      expect(parsed.transforms).toHaveLength(1);
      expect(parsed.transforms?.[0].key).toBe('stubNoop');
      expect(typeof parsed.transforms?.[0].apply).toBe('function');
    }
  });

  it('rejects transforms on an endpoint source', () => {
    expect(() =>
      parseSourceSpec({
        endpoint: 'https://example.com/sparql',
        // @ts-expect-error — transforms only valid on glob
        transforms: [],
      }),
    ).toThrow(/`transforms`.*only.*glob.*endpoint/);
  });

  it('rejects transforms on a view source', () => {
    expect(() =>
      parseSourceSpec({
        id: 'v',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        // @ts-expect-error — transforms only valid on glob
        transforms: [],
      }),
    ).toThrow(/`transforms`.*only.*glob.*view/);
  });

  it('rejects transforms on an empty source', () => {
    expect(() =>
      parseSourceSpec({
        id: 'composer',
        empty: true,
        // @ts-expect-error — transforms only valid on glob
        transforms: [],
      }),
    ).toThrow(/empty source.*`transforms`/);
  });
});

describe('parseSourceSpec — prefilter is removed', () => {
  it('does not surface a prefilter field on the parsed glob source even if the input still has one', () => {
    const parsed = parseSourceSpec({
      glob: 'a/*.ttl',
      // @ts-expect-error — `prefilter` was removed from the source-spec shape
      prefilter: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
    });
    expect((parsed as Record<string, unknown>).prefilter).toBeUndefined();
    expect((parsed as Record<string, unknown>).prefilterFile).toBeUndefined();
  });

  it('does not surface a prefilterFile field on the parsed endpoint source', () => {
    const parsed = parseSourceSpec({
      endpoint: 'https://example.com/sparql',
      // @ts-expect-error — `prefilterFile` was removed from the source-spec shape
      prefilterFile: './pf.rq',
    });
    expect((parsed as Record<string, unknown>).prefilter).toBeUndefined();
    expect((parsed as Record<string, unknown>).prefilterFile).toBeUndefined();
  });
});

describe('parseSourceSpec — source id', () => {
  it.each([
    'a',
    'A',
    '0',
    'my-source',
    'my_source',
    'my.source',
    'mixedCASE',
    '_leading-underscore',
    '-leading-dash',
    '0-leading-digit',
  ])('accepts the slug %s', (id) => {
    expect(parseSourceSpec({ glob: 'x.ttl', id }).id).toBe(id);
  });

  it.each(['', '.dot-leading', 'spaces here', 'has/slash', 'has:colon', 'a!'])(
    'rejects the malformed id %j',
    (id) => {
      expect(() => parseSourceSpec({ glob: 'x.ttl', id })).toThrow(
        /source id .* must match/i,
      );
    },
  );

  it('rejects an id with a leading @', () => {
    expect(() => parseSourceSpec({ glob: 'x.ttl', id: '@nope' })).toThrow(
      /must not start with `@`/,
    );
  });

  it('treats ids as case-sensitive (regex permits both cases)', () => {
    expect(parseSourceSpec({ glob: 'x.ttl', id: 'Foo' }).id).toBe('Foo');
    expect(parseSourceSpec({ glob: 'x.ttl', id: 'foo' }).id).toBe('foo');
  });
});

describe('parseSourceSpec — endpoint HTTP fields (auth, headers, timeoutMs)', () => {
  it('carries through bearer auth on an endpoint object', () => {
    expect(
      parseSourceSpec({
        endpoint: 'https://example.com/sparql',
        auth: { type: 'bearer', token: 'tk-1' },
      }),
    ).toEqual({
      kind: 'endpoint',
      endpoint: 'https://example.com/sparql',
      auth: { type: 'bearer', token: 'tk-1' },
    });
  });

  it('carries through basic auth on an endpoint object', () => {
    expect(
      parseSourceSpec({
        endpoint: 'https://example.com/sparql',
        auth: { type: 'basic', username: 'alice', password: 'hunter2' },
      }),
    ).toEqual({
      kind: 'endpoint',
      endpoint: 'https://example.com/sparql',
      auth: { type: 'basic', username: 'alice', password: 'hunter2' },
    });
  });

  it('carries through arbitrary headers on an endpoint object', () => {
    expect(
      parseSourceSpec({
        endpoint: 'https://example.com/sparql',
        headers: { 'X-Tenant': 'acme', 'X-Trace': 'abc' },
      }),
    ).toEqual({
      kind: 'endpoint',
      endpoint: 'https://example.com/sparql',
      headers: { 'X-Tenant': 'acme', 'X-Trace': 'abc' },
    });
  });

  it('carries through timeoutMs on an endpoint object', () => {
    expect(
      parseSourceSpec({
        endpoint: 'https://example.com/sparql',
        timeoutMs: 5000,
      }),
    ).toEqual({
      kind: 'endpoint',
      endpoint: 'https://example.com/sparql',
      timeoutMs: 5000,
    });
  });

  it('rejects auth + a colliding Authorization header (case-insensitive)', () => {
    expect(() =>
      parseSourceSpec({
        endpoint: 'https://example.com/sparql',
        auth: { type: 'bearer', token: 'tk-1' },
        headers: { authorization: 'Bearer other' },
      }),
    ).toThrow(/auth.*Authorization.*collide/i);
  });

  it('rejects bearer auth with an empty token', () => {
    expect(() =>
      parseSourceSpec({
        endpoint: 'https://example.com/sparql',
        auth: { type: 'bearer', token: '' },
      }),
    ).toThrow(/bearer.*token.*non-empty/i);
  });

  it('rejects basic auth missing username or password', () => {
    expect(() =>
      parseSourceSpec({
        endpoint: 'https://example.com/sparql',
        auth: { type: 'basic', username: '', password: 'p' },
      }),
    ).toThrow(/basic.*username.*non-empty/i);
    expect(() =>
      parseSourceSpec({
        endpoint: 'https://example.com/sparql',
        auth: { type: 'basic', username: 'u', password: '' },
      }),
    ).toThrow(/basic.*password.*non-empty/i);
  });

  it('rejects auth/headers/timeoutMs on a glob source', () => {
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.ttl',
        auth: { type: 'bearer', token: 'tk' },
      } as unknown as Parameters<typeof parseSourceSpec>[0]),
    ).toThrow(/auth.*only.*endpoint/i);
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.ttl',
        headers: { 'X-Tenant': 'acme' },
      } as unknown as Parameters<typeof parseSourceSpec>[0]),
    ).toThrow(/headers.*only.*endpoint/i);
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.ttl',
        timeoutMs: 1000,
      } as unknown as Parameters<typeof parseSourceSpec>[0]),
    ).toThrow(/timeoutMs.*only.*endpoint/i);
  });
});

describe('parseSourceSpec — default: true marker', () => {
  it('accepts default: true on a glob source and propagates it to the parsed output', () => {
    expect(
      parseSourceSpec({ glob: 'data/*.ttl', id: 'files', default: true }),
    ).toEqual({
      kind: 'glob',
      glob: 'data/*.ttl',
      id: 'files',
      default: true,
    });
  });

  it('does not allow default: true on a reference (string-form refs cannot carry default)', () => {
    // String-form `@id` is the only path to `kind: 'reference'`; strings cannot carry a default flag,
    // so a reference with `default: true` is structurally impossible.
    const parsed = parseSourceSpec('@my-alias');
    expect(parsed).toEqual({ kind: 'reference', ref: 'my-alias' });
    expect((parsed as unknown as Record<string, unknown>)['default']).toBeUndefined();
  });

  it('rejects default: false explicitly (the marker must be `true` to opt in)', () => {
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.ttl',
        // @ts-expect-error — default must be `true` to opt in
        default: false,
      }),
    ).toThrow(/`default`.*true/i);
  });

  it('accepts default: true on a view source', () => {
    expect(
      parseSourceSpec({
        id: 'filtered',
        from: '@raw',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        default: true,
      }),
    ).toEqual({
      kind: 'view',
      id: 'filtered',
      from: 'raw',
      query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      default: true,
    });
  });

  it('accepts default: true on an empty source', () => {
    expect(
      parseSourceSpec({ id: 'composer', empty: true, default: true }),
    ).toEqual({
      kind: 'empty',
      id: 'composer',
      default: true,
    });
  });

  it('accepts default: true on an endpoint source', () => {
    expect(
      parseSourceSpec({
        endpoint: 'https://example.com/sparql',
        id: 'live',
        default: true,
      }),
    ).toEqual({
      kind: 'endpoint',
      endpoint: 'https://example.com/sparql',
      id: 'live',
      default: true,
    });
  });
});

describe('parseSourceSpecs — view from: single-ref invariant', () => {
  const VIEW_QUERY = 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }';

  it('accepts a view whose `from` is a single endpoint ref', () => {
    expect(() =>
      parseSourceSpecs([
        { endpoint: 'https://example.com/sparql', id: 'live' },
        { id: 'scoped', from: '@live', query: VIEW_QUERY },
      ]),
    ).not.toThrow();
  });

  it('accepts a view whose `from` is a single glob ref', () => {
    expect(() =>
      parseSourceSpecs([
        { glob: 'data/*.ttl', id: 'files' },
        { id: 'scoped', from: '@files', query: VIEW_QUERY },
      ]),
    ).not.toThrow();
  });
});

describe('parseSourceSpecs — registry-level default validation', () => {
  it('accepts a registry with exactly one default: true entry', () => {
    const parsed = parseSourceSpecs([
      { glob: 'a/*.ttl', id: 'one', default: true },
      { glob: 'b/*.ttl', id: 'two' },
    ]);
    expect(parsed[0]).toMatchObject({ id: 'one', default: true });
    expect((parsed[1] as unknown as Record<string, unknown>)['default']).toBeUndefined();
  });

  it('accepts a registry with no default: true entries', () => {
    const parsed = parseSourceSpecs([
      { glob: 'a/*.ttl', id: 'one' },
      { glob: 'b/*.ttl', id: 'two' },
    ]);
    for (const p of parsed) {
      expect((p as unknown as Record<string, unknown>)['default']).toBeUndefined();
    }
  });

  it('rejects a registry where more than one entry carries default: true and names both locations', () => {
    expect(() =>
      parseSourceSpecs(
        [
          { glob: 'a/*.ttl', id: 'one', default: true },
          { glob: 'b/*.ttl', id: 'two', default: true },
        ],
        { locations: ['config:sources[0]', 'config:sources[1]'] },
      ),
    ).toThrow(/more than one.*default.*config:sources\[0\].*config:sources\[1\]/s);
  });

  it('reports an integer index when no explicit location is provided for multi-default', () => {
    expect(() =>
      parseSourceSpecs([
        { glob: 'a/*.ttl', id: 'one', default: true },
        { glob: 'b/*.ttl', id: 'two', default: true },
      ]),
    ).toThrow(/more than one.*default.*sources\[0\].*sources\[1\]/s);
  });

  it('still surfaces parse errors in unrelated entries when default markers are in play', () => {
    // An unrelated entry has a malformed id; default markers elsewhere do not mask it.
    expect(() =>
      parseSourceSpecs([
        { glob: 'a/*.ttl', id: 'ok', default: true },
        { glob: 'b/*.ttl', id: 'has spaces' },
      ]),
    ).toThrow(/source id .* must match/i);
  });
});

describe('parseSourceSpecs — id collision detection', () => {
  it('parses each entry without an id without complaint', () => {
    const parsed = parseSourceSpecs([
      'a/*.ttl',
      'b/*.ttl',
      { glob: 'c/*.ttl' },
    ]);
    expect(parsed).toHaveLength(3);
  });

  it('parses unique ids without complaint', () => {
    const parsed = parseSourceSpecs([
      { glob: 'a/*.ttl', id: 'one' },
      { glob: 'b/*.ttl', id: 'two' },
    ]);
    expect(parsed.map((s) => s.id)).toEqual(['one', 'two']);
  });

  it('rejects two entries that share an id and names both definition locations', () => {
    expect(() =>
      parseSourceSpecs(
        [
          { glob: 'a/*.ttl', id: 'dup' },
          { glob: 'b/*.ttl', id: 'dup' },
        ],
        {
          locations: ['config:sources[0]', 'config:sources[1]'],
        },
      ),
    ).toThrow(/duplicate source id "dup".*config:sources\[0\].*config:sources\[1\]/s);
  });

  it('reports an integer index when no explicit location is provided', () => {
    expect(() =>
      parseSourceSpecs([
        { glob: 'a/*.ttl', id: 'dup' },
        { glob: 'b/*.ttl', id: 'dup' },
      ]),
    ).toThrow(/duplicate source id "dup".*sources\[0\].*sources\[1\]/s);
  });

  it('treats different cases as distinct ids', () => {
    expect(() =>
      parseSourceSpecs([
        { glob: 'a/*.ttl', id: 'Foo' },
        { glob: 'b/*.ttl', id: 'foo' },
      ]),
    ).not.toThrow();
  });
});
