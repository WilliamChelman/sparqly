import { describe, it, expect } from 'vitest';
import { parseRdfString } from './parse-rdf-string';

describe('parseRdfString', () => {
  it('returns empty result for empty input', () => {
    const result = parseRdfString('');
    expect(result.quads).toEqual([]);
    expect(result.prefixes).toEqual({});
    expect(result.base).toBeUndefined();
  });

  it('extracts prefixes', () => {
    const text = [
      '@prefix ex: <http://example.org/> .',
      '@prefix foaf: <http://xmlns.com/foaf/0.1/> .',
      'ex:alice foaf:name "Alice" .',
    ].join('\n');
    const { prefixes, quads } = parseRdfString(text);
    expect(prefixes).toEqual({
      ex: 'http://example.org/',
      foaf: 'http://xmlns.com/foaf/0.1/',
    });
    expect(quads).toHaveLength(1);
  });

  it('extracts @base directive', () => {
    const text = [
      '@base <http://example.org/base/> .',
      '@prefix ex: <http://example.org/> .',
      'ex:alice ex:knows ex:bob .',
    ].join('\n');
    const { base } = parseRdfString(text);
    expect(base).toBe('http://example.org/base/');
  });

  it('returns base undefined when no @base directive', () => {
    const text = '@prefix ex: <http://example.org/> .\nex:alice ex:knows ex:bob .';
    expect(parseRdfString(text).base).toBeUndefined();
  });

  it('parses turtle when format: turtle is set', () => {
    const text = '@prefix ex: <http://example.org/> .\nex:a ex:b ex:c .';
    const { quads } = parseRdfString(text, { format: 'turtle' });
    expect(quads).toHaveLength(1);
    expect(quads[0].graph.termType).toBe('DefaultGraph');
  });

  it('parses trig with named graphs when format: trig is set', () => {
    const text = [
      '@prefix ex: <http://example.org/> .',
      'ex:g1 { ex:a ex:b ex:c . }',
    ].join('\n');
    const { quads } = parseRdfString(text, { format: 'trig' });
    expect(quads).toHaveLength(1);
    expect(quads[0].graph.termType).toBe('NamedNode');
    expect(quads[0].graph.value).toBe('http://example.org/g1');
  });

  it('auto-detects trig when format option is omitted', () => {
    const text = [
      '@prefix ex: <http://example.org/> .',
      'ex:g1 { ex:a ex:b ex:c . }',
    ].join('\n');
    const { quads } = parseRdfString(text);
    expect(quads).toHaveLength(1);
    expect(quads[0].graph.termType).toBe('NamedNode');
    expect(quads[0].graph.value).toBe('http://example.org/g1');
  });

  it('throws on malformed input', () => {
    expect(() => parseRdfString('this is not valid turtle <<<')).toThrow();
  });
});
