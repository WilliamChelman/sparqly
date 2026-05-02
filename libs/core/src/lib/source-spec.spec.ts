import { describe, expect, it } from 'vitest';
import { parseSourceSpec, parseSourceSpecs } from './source-spec';

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
        graphMode: 'flatten',
        graph: 'urn:my:graph',
        prefilter: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      }),
    ).toEqual({
      kind: 'glob',
      glob: 'data/*.ttl',
      id: 'vocab',
      graphMode: 'flatten',
      graph: 'urn:my:graph',
      prefilter: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
    });
  });

  it('rejects an object with both glob: and endpoint:', () => {
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.ttl',
        endpoint: 'https://example.com/sparql',
      }),
    ).toThrow(/exactly one of `glob:`, `endpoint:`, or `from:`/);
  });

  it('rejects an object with no glob:, endpoint:, or from:', () => {
    expect(() => parseSourceSpec({ id: 'orphan' })).toThrow(
      /exactly one of `glob:`, `endpoint:`, or `from:`/,
    );
  });
});

describe('parseSourceSpec — view discriminant', () => {
  it('parses a view with from refs, an inline query, and an id', () => {
    expect(
      parseSourceSpec({
        id: 'filtered',
        from: ['@raw'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      }),
    ).toEqual({
      kind: 'view',
      id: 'filtered',
      from: ['raw'],
      query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
    });
  });

  it('parses a view with queryFile instead of inline query', () => {
    expect(
      parseSourceSpec({
        id: 'filtered',
        from: ['@raw'],
        queryFile: './scope.rq',
      }),
    ).toEqual({
      kind: 'view',
      id: 'filtered',
      from: ['raw'],
      queryFile: './scope.rq',
    });
  });

  it('parses a view with multiple from refs', () => {
    expect(
      parseSourceSpec({
        id: 'fanned',
        from: ['@a', '@b'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      }),
    ).toMatchObject({
      kind: 'view',
      from: ['a', 'b'],
    });
  });

  it('rejects a view with both query and queryFile', () => {
    expect(() =>
      parseSourceSpec({
        id: 'filtered',
        from: ['@raw'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        queryFile: './scope.rq',
      }),
    ).toThrow(/`query`.*`queryFile`.*mutual/i);
  });

  it('rejects a view with neither query nor queryFile', () => {
    expect(() =>
      parseSourceSpec({
        id: 'filtered',
        from: ['@raw'],
      }),
    ).toThrow(/view.*exactly one of `query`.*`queryFile`/i);
  });

  it('rejects a view without an id', () => {
    expect(() =>
      parseSourceSpec({
        from: ['@raw'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      }),
    ).toThrow(/view.*id.*required/i);
  });

  it('rejects a view with an empty from list', () => {
    expect(() =>
      parseSourceSpec({
        id: 'filtered',
        from: [],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      }),
    ).toThrow(/view.*from.*at least one/i);
  });

  it('rejects a from entry that is not a `@id` reference', () => {
    expect(() =>
      parseSourceSpec({
        id: 'filtered',
        from: ['raw'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      }),
    ).toThrow(/from.*ref.*@/i);
  });

  it('rejects a view that also declares glob:', () => {
    expect(() =>
      parseSourceSpec({
        id: 'mix',
        from: ['@raw'],
        glob: 'data/*.ttl',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      }),
    ).toThrow(/exactly one of `glob:`, `endpoint:`, or `from:`/);
  });

  it('rejects a view that also declares endpoint:', () => {
    expect(() =>
      parseSourceSpec({
        id: 'mix',
        from: ['@raw'],
        endpoint: 'https://example.org/sparql',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      }),
    ).toThrow(/exactly one of `glob:`, `endpoint:`, or `from:`/);
  });
});

describe('parseSourceSpec — prefilter mutex', () => {
  it('accepts prefilter alone', () => {
    expect(
      parseSourceSpec({
        glob: 'a/*.ttl',
        prefilter: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      }).prefilter,
    ).toMatch(/CONSTRUCT/);
  });

  it('accepts prefilterFile alone', () => {
    expect(
      parseSourceSpec({ glob: 'a/*.ttl', prefilterFile: './pf.rq' })
        .prefilterFile,
    ).toBe('./pf.rq');
  });

  it('rejects an object that sets both prefilter and prefilterFile', () => {
    expect(() =>
      parseSourceSpec({
        glob: 'a/*.ttl',
        prefilter: 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }',
        prefilterFile: './pf.rq',
      }),
    ).toThrow(/`prefilter`.*`prefilterFile`.*mutual/i);
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
