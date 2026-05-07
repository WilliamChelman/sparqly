import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFIXES,
  shortenNQuadLine,
} from './shorten-nquad-line';

describe('shortenNQuadLine', () => {
  it('shortens NamedNode subjects, predicates, and objects against the prefix map', () => {
    const line =
      '<http://example.org/Foo> <http://www.w3.org/2000/01/rdf-schema#label> "Foo" .';
    const out = shortenNQuadLine(line, {
      prefixes: { rdfs: 'http://www.w3.org/2000/01/rdf-schema#', ex: 'http://example.org/' },
    });
    expect(out).toBe('ex:Foo rdfs:label "Foo" .');
  });

  it('renders rdf:type as "a"', () => {
    const line =
      '<http://example.org/Foo> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Bar> .';
    const out = shortenNQuadLine(line, { prefixes: { ex: 'http://example.org/' } });
    expect(out).toBe('ex:Foo a ex:Bar .');
  });

  it('keeps full IRIs in <…> when no prefix matches', () => {
    const line =
      '<http://example.org/Foo> <http://example.org/p> <http://example.org/Bar> .';
    const out = shortenNQuadLine(line, { prefixes: {} });
    expect(out).toBe(
      '<http://example.org/Foo> <http://example.org/p> <http://example.org/Bar> .',
    );
  });

  it('preserves graph component for named-graph N-Quads', () => {
    const line =
      '<http://example.org/s> <http://example.org/p> <http://example.org/o> <http://example.org/g> .';
    const out = shortenNQuadLine(line, { prefixes: { ex: 'http://example.org/' } });
    expect(out).toBe('ex:s ex:p ex:o ex:g .');
  });

  it('returns the input untouched when the line is not a single quad', () => {
    expect(shortenNQuadLine('not a quad at all', { prefixes: {} })).toBe(
      'not a quad at all',
    );
  });

  it('DEFAULT_PREFIXES covers rdf, rdfs, owl, and xsd', () => {
    expect(DEFAULT_PREFIXES.rdf).toBe(
      'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    );
    expect(DEFAULT_PREFIXES.rdfs).toBe(
      'http://www.w3.org/2000/01/rdf-schema#',
    );
    expect(DEFAULT_PREFIXES.owl).toBe('http://www.w3.org/2002/07/owl#');
    expect(DEFAULT_PREFIXES.xsd).toBe('http://www.w3.org/2001/XMLSchema#');
  });
});
