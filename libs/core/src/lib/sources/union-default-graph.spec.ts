import { describe, expect, it } from 'vitest';
import { parseSourceSpec, type ParsedFileSource } from './source-spec';
import { unionDefaultGraphEnabled } from './union-default-graph';

const VIEW_QUERY = 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }';

describe('parseSourceSpec — unionDefaultGraph (ADR-0040)', () => {
  it('carries an explicit `unionDefaultGraph: false` through onto the parsed glob', () => {
    expect(
      parseSourceSpec({ glob: 'data/*.trig', unionDefaultGraph: false }),
    ).toEqual({
      kind: 'glob',
      glob: 'data/*.trig',
      unionDefaultGraph: false,
    });
  });

  it('carries an explicit `unionDefaultGraph: true` through onto the parsed glob', () => {
    expect(
      parseSourceSpec({ glob: 'data/*.trig', unionDefaultGraph: true }),
    ).toEqual({
      kind: 'glob',
      glob: 'data/*.trig',
      unionDefaultGraph: true,
    });
  });

  it('omits `unionDefaultGraph` on the parsed glob when it is not declared', () => {
    const parsed = parseSourceSpec({ glob: 'data/*.trig' });
    expect((parsed as Record<string, unknown>).unionDefaultGraph).toBeUndefined();
  });

  it('rejects a non-boolean `unionDefaultGraph`', () => {
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.trig',
        // @ts-expect-error — unionDefaultGraph must be a boolean
        unionDefaultGraph: 'yes',
      }),
    ).toThrow(/unionDefaultGraph.*boolean/i);
  });

  it('rejects `unionDefaultGraph` on an endpoint source with a useful message', () => {
    expect(() =>
      parseSourceSpec({
        endpoint: 'https://example.com/sparql',
        // @ts-expect-error — unionDefaultGraph only valid on glob
        unionDefaultGraph: true,
      }),
    ).toThrow(/unionDefaultGraph.*only.*glob.*endpoint/i);
  });

  it('rejects `unionDefaultGraph` on a view source with a useful message', () => {
    expect(() =>
      parseSourceSpec({
        id: 'scoped',
        from: '@raw',
        query: VIEW_QUERY,
        // @ts-expect-error — unionDefaultGraph only valid on glob
        unionDefaultGraph: true,
      }),
    ).toThrow(/unionDefaultGraph.*only.*glob.*view/i);
  });

  it('rejects `unionDefaultGraph` on an empty source with a useful message', () => {
    expect(() =>
      parseSourceSpec({
        id: 'composer',
        empty: true,
        // @ts-expect-error — unionDefaultGraph only valid on glob
        unionDefaultGraph: false,
      }),
    ).toThrow(/unionDefaultGraph.*only.*glob.*empty/i);
  });
});

describe('unionDefaultGraphEnabled (ADR-0040)', () => {
  it('defaults a glob with no declared `unionDefaultGraph` to true', () => {
    expect(unionDefaultGraphEnabled(parseSourceSpec('data/*.trig'))).toBe(true);
  });

  it('honours an explicit `unionDefaultGraph: false` on a glob', () => {
    expect(
      unionDefaultGraphEnabled(
        parseSourceSpec({ glob: 'data/*.trig', unionDefaultGraph: false }),
      ),
    ).toBe(false);
  });

  it('honours an explicit `unionDefaultGraph: true` on a glob', () => {
    expect(
      unionDefaultGraphEnabled(
        parseSourceSpec({ glob: 'data/*.trig', unionDefaultGraph: true }),
      ),
    ).toBe(true);
  });

  it('defaults a file source with no declared `unionDefaultGraph` to true', () => {
    const file: ParsedFileSource = {
      kind: 'file',
      id: 'docs/a.trig',
      path: '/abs/data/a.trig',
      parentId: 'docs',
    };
    expect(unionDefaultGraphEnabled(file)).toBe(true);
  });

  it('honours an explicit `unionDefaultGraph: false` inherited onto a file source', () => {
    const file: ParsedFileSource = {
      kind: 'file',
      id: 'docs/a.trig',
      path: '/abs/data/a.trig',
      parentId: 'docs',
      unionDefaultGraph: false,
    };
    expect(unionDefaultGraphEnabled(file)).toBe(false);
  });

  it('reports false for non-glob sources — a view, endpoint, or empty owns standard SPARQL semantics', () => {
    expect(
      unionDefaultGraphEnabled(parseSourceSpec('https://example.com/sparql')),
    ).toBe(false);
    expect(
      unionDefaultGraphEnabled(
        parseSourceSpec({ id: 'v', from: '@raw', query: VIEW_QUERY }),
      ),
    ).toBe(false);
    expect(
      unionDefaultGraphEnabled(parseSourceSpec({ id: 'e', empty: true })),
    ).toBe(false);
  });
});
