import { describe, expect, it } from 'vitest';
import { parseSourceSpec } from './source-spec';
import { storageTier } from './glob-storage';

const VIEW_QUERY = 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }';

describe('parseSourceSpec — storage (ADR-0041)', () => {
  it('carries an explicit `storage: disk` through onto the parsed glob', () => {
    expect(parseSourceSpec({ glob: 'data/*.trig', storage: 'disk' })).toEqual({
      kind: 'glob',
      glob: 'data/*.trig',
      storage: 'disk',
    });
  });

  it('carries an explicit `storage: memory` through onto the parsed glob', () => {
    expect(parseSourceSpec({ glob: 'data/*.trig', storage: 'memory' })).toEqual({
      kind: 'glob',
      glob: 'data/*.trig',
      storage: 'memory',
    });
  });

  it('omits `storage` on the parsed glob when it is not declared', () => {
    const parsed = parseSourceSpec({ glob: 'data/*.trig' });
    expect((parsed as Record<string, unknown>).storage).toBeUndefined();
  });

  it('rejects a `storage` value that is not `memory` or `disk`', () => {
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.trig',
        // @ts-expect-error — storage must be 'memory' or 'disk'
        storage: 'cloud',
      }),
    ).toThrow(/storage.*memory.*disk/i);
  });

  it('rejects `storage` on an endpoint source with a useful message', () => {
    expect(() =>
      parseSourceSpec({
        endpoint: 'https://example.com/sparql',
        // @ts-expect-error — storage only valid on glob
        storage: 'disk',
      }),
    ).toThrow(/storage.*only.*glob.*endpoint/i);
  });

  it('rejects `storage` on a view source with a useful message', () => {
    expect(() =>
      parseSourceSpec({
        id: 'scoped',
        from: '@raw',
        query: VIEW_QUERY,
        // @ts-expect-error — storage only valid on glob
        storage: 'disk',
      }),
    ).toThrow(/storage.*only.*glob.*view/i);
  });

  it('rejects `storage` on an empty source with a useful message', () => {
    expect(() =>
      parseSourceSpec({
        id: 'composer',
        empty: true,
        // @ts-expect-error — storage only valid on glob
        storage: 'memory',
      }),
    ).toThrow(/storage.*only.*glob.*empty/i);
  });
});

describe('storageTier (ADR-0041)', () => {
  it('defaults a glob with no declared `storage` to memory', () => {
    expect(storageTier(parseSourceSpec('data/*.trig'))).toBe('memory');
  });

  it('honours an explicit `storage: disk` on a glob', () => {
    expect(
      storageTier(parseSourceSpec({ glob: 'data/*.trig', storage: 'disk' })),
    ).toBe('disk');
  });

  it('honours an explicit `storage: memory` on a glob', () => {
    expect(
      storageTier(parseSourceSpec({ glob: 'data/*.trig', storage: 'memory' })),
    ).toBe('memory');
  });

  it('reports memory for non-glob sources — an endpoint, view, or empty materializes nothing', () => {
    expect(storageTier(parseSourceSpec('https://example.com/sparql'))).toBe(
      'memory',
    );
    expect(
      storageTier(
        parseSourceSpec({ id: 'v', from: '@raw', query: VIEW_QUERY }),
      ),
    ).toBe('memory');
    expect(storageTier(parseSourceSpec({ id: 'e', empty: true }))).toBe(
      'memory',
    );
  });
});
