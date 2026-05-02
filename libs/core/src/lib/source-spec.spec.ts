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
    ).toThrow(/exactly one of `glob:` or `endpoint:`/);
  });

  it('rejects an object with neither glob: nor endpoint:', () => {
    expect(() => parseSourceSpec({ id: 'orphan' })).toThrow(
      /exactly one of `glob:` or `endpoint:`/,
    );
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
