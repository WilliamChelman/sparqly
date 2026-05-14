import { describe, expect, it } from 'vitest';
import {
  SOURCE_ID_REGEX,
  SYNTHESIZED_SOURCE_ID_REGEX,
  parseSourceSpec,
  parseSourceSpecs,
  validateSynthesizedFileSource,
  type ParsedFileSource,
} from './source-spec';

const VIEW_QUERY = 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }';

describe('parseSourceSpec — splitByFile flag', () => {
  it('accepts splitByFile: true on a glob source and propagates it to the parsed output', () => {
    expect(
      parseSourceSpec({ glob: 'data/*.ttl', id: 'docs', splitByFile: true }),
    ).toEqual({
      kind: 'glob',
      glob: 'data/*.ttl',
      id: 'docs',
      splitByFile: true,
    });
  });

  it('omits splitByFile on the parsed glob when it is not declared', () => {
    const parsed = parseSourceSpec({ glob: 'data/*.ttl' });
    expect((parsed as Record<string, unknown>).splitByFile).toBeUndefined();
  });

  it('rejects splitByFile: false (the flag must be `true` to opt in)', () => {
    expect(() =>
      parseSourceSpec({
        glob: 'data/*.ttl',
        // @ts-expect-error — splitByFile must be `true` to opt in
        splitByFile: false,
      }),
    ).toThrow(/splitByFile.*true/i);
  });

  it('rejects splitByFile on an endpoint source with a useful message', () => {
    expect(() =>
      parseSourceSpec({
        endpoint: 'https://example.com/sparql',
        // @ts-expect-error — splitByFile only valid on glob
        splitByFile: true,
      }),
    ).toThrow(/splitByFile.*only.*glob.*endpoint/i);
  });

  it('rejects splitByFile on a view source with a useful message', () => {
    expect(() =>
      parseSourceSpec({
        id: 'scoped',
        from: '@raw',
        query: VIEW_QUERY,
        // @ts-expect-error — splitByFile only valid on glob
        splitByFile: true,
      }),
    ).toThrow(/splitByFile.*only.*glob.*view/i);
  });

  it('rejects splitByFile on an empty source with a useful message', () => {
    expect(() =>
      parseSourceSpec({
        id: 'composer',
        empty: true,
        // @ts-expect-error — splitByFile only valid on glob
        splitByFile: true,
      }),
    ).toThrow(/splitByFile.*only.*glob.*empty/i);
  });

  it('never produces kind: file (parseSourceSpecs stays sync; expansion is a separate pass)', () => {
    const parsed = parseSourceSpecs([
      { glob: 'data/*.ttl', id: 'docs', splitByFile: true },
    ]);
    for (const entry of parsed) {
      expect(entry.kind).not.toBe('file');
    }
  });
});

describe('source-spec — synthesized id regex (ADR-0027)', () => {
  it('SOURCE_ID_REGEX (user-declared) still rejects `/`', () => {
    expect(SOURCE_ID_REGEX.test('docs/foo.ttl')).toBe(false);
    expect(SOURCE_ID_REGEX.test('docs/a/b.ttl')).toBe(false);
  });

  it('SYNTHESIZED_SOURCE_ID_REGEX accepts `<parent>/<single-segment>` ids', () => {
    expect(SYNTHESIZED_SOURCE_ID_REGEX.test('docs/foo.ttl')).toBe(true);
  });

  it('SYNTHESIZED_SOURCE_ID_REGEX accepts deeply nested `<parent>/<a>/<b>/<c>` ids', () => {
    expect(SYNTHESIZED_SOURCE_ID_REGEX.test('docs/a/b/c.ttl')).toBe(true);
  });

  it('SYNTHESIZED_SOURCE_ID_REGEX accepts dots and dashes in segments', () => {
    expect(SYNTHESIZED_SOURCE_ID_REGEX.test('docs/people/al.ice.ttl')).toBe(true);
    expect(SYNTHESIZED_SOURCE_ID_REGEX.test('docs/a-b/my-file.ttl')).toBe(true);
  });

  it('SYNTHESIZED_SOURCE_ID_REGEX still rejects a leading `/` (absolute-style)', () => {
    expect(SYNTHESIZED_SOURCE_ID_REGEX.test('/docs/foo.ttl')).toBe(false);
  });

  it('SYNTHESIZED_SOURCE_ID_REGEX still rejects empty segments (no `//` pairs)', () => {
    expect(SYNTHESIZED_SOURCE_ID_REGEX.test('docs//foo.ttl')).toBe(false);
  });

  it('SYNTHESIZED_SOURCE_ID_REGEX still rejects a bare ids with no `/` (those are user-declared)', () => {
    expect(SYNTHESIZED_SOURCE_ID_REGEX.test('docs')).toBe(false);
  });
});

describe('validateSynthesizedFileSource — synthesis-bug guard', () => {
  const VALID: ParsedFileSource = {
    kind: 'file',
    id: 'docs/foo.ttl',
    path: '/abs/proj/data/foo.ttl',
    parentId: 'docs',
  };

  it('accepts a well-formed synthesized file source', () => {
    expect(() => validateSynthesizedFileSource(VALID)).not.toThrow();
  });

  it('rejects a synthesized child carrying default: true', () => {
    expect(() =>
      validateSynthesizedFileSource({
        ...VALID,
        // Cast: ParsedFileSource shape has no `default`; this guards against
        // a synthesis bug that produces a child with the marker.
        ...({ default: true } as Record<string, unknown>),
      } as ParsedFileSource),
    ).toThrow(/synth.*default/i);
  });

  it('rejects a synthesized child whose id fails SYNTHESIZED_SOURCE_ID_REGEX', () => {
    expect(() =>
      validateSynthesizedFileSource({ ...VALID, id: 'has spaces/foo.ttl' }),
    ).toThrow(/synth.*id/i);
  });
});
