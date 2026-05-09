import { renderTerm } from './term-renderer';
import type { DisplayContext } from './config.service';

const EMPTY: DisplayContext = { prefixes: {} };

describe('renderTerm — IRI', () => {
  it('renders a NamedNode as prefixed-iri when a registered prefix matches', () => {
    const ctx: DisplayContext = {
      prefixes: { ex: 'http://example.org/' },
    };
    const r = renderTerm(
      { termType: 'NamedNode', value: 'http://example.org/Foo' },
      ctx,
    );
    expect(r.kind).toBe('prefixed-iri');
    if (r.kind !== 'prefixed-iri') return;
    expect(r.prefix).toBe('ex');
    expect(r.local).toBe('Foo');
    expect(r.iri).toBe('http://example.org/Foo');
  });

  it('uses the longest matching prefix when several apply', () => {
    const ctx: DisplayContext = {
      prefixes: {
        ex: 'http://example.org/',
        exVoc: 'http://example.org/vocab/',
      },
    };
    const r = renderTerm(
      { termType: 'NamedNode', value: 'http://example.org/vocab/Foo' },
      ctx,
    );
    if (r.kind !== 'prefixed-iri') throw new Error('expected prefixed-iri');
    expect(r.prefix).toBe('exVoc');
    expect(r.local).toBe('Foo');
  });

  it('renders a NamedNode as base-iri when only base matches', () => {
    const ctx: DisplayContext = {
      prefixes: { other: 'http://other.example/' },
      base: 'http://example.org/',
    };
    const r = renderTerm(
      { termType: 'NamedNode', value: 'http://example.org/Foo' },
      ctx,
    );
    expect(r.kind).toBe('base-iri');
    if (r.kind !== 'base-iri') return;
    expect(r.local).toBe('Foo');
    expect(r.iri).toBe('http://example.org/Foo');
  });

  it('prefers a prefix match over a base match', () => {
    const ctx: DisplayContext = {
      prefixes: { ex: 'http://example.org/' },
      base: 'http://example.org/',
    };
    const r = renderTerm(
      { termType: 'NamedNode', value: 'http://example.org/Foo' },
      ctx,
    );
    expect(r.kind).toBe('prefixed-iri');
  });

  it('renders a NamedNode as absolute-iri when nothing matches', () => {
    const ctx: DisplayContext = {
      prefixes: { ex: 'http://example.org/' },
      base: 'http://example.org/',
    };
    const r = renderTerm(
      { termType: 'NamedNode', value: 'http://other.example/x' },
      ctx,
    );
    expect(r.kind).toBe('absolute-iri');
    if (r.kind !== 'absolute-iri') return;
    expect(r.iri).toBe('http://other.example/x');
  });

  it('falls back to absolute-iri on an empty DisplayContext', () => {
    const r = renderTerm(
      { termType: 'NamedNode', value: 'http://example.org/Foo' },
      EMPTY,
    );
    expect(r.kind).toBe('absolute-iri');
  });
});

describe('renderTerm — Literals', () => {
  it('renders a plain xsd:string literal as plain-literal', () => {
    const r = renderTerm(
      { termType: 'Literal', value: 'hello' },
      EMPTY,
    );
    expect(r.kind).toBe('plain-literal');
    if (r.kind !== 'plain-literal') return;
    expect(r.lexical).toBe('hello');
  });

  it('renders a language-tagged literal as language-literal', () => {
    const r = renderTerm(
      { termType: 'Literal', value: 'bonjour', language: 'fr' },
      EMPTY,
    );
    expect(r.kind).toBe('language-literal');
    if (r.kind !== 'language-literal') return;
    expect(r.lexical).toBe('bonjour');
    expect(r.language).toBe('fr');
  });

  it('renders xsd:integer / xsd:decimal / xsd:double as number', () => {
    for (const dt of [
      'http://www.w3.org/2001/XMLSchema#integer',
      'http://www.w3.org/2001/XMLSchema#decimal',
      'http://www.w3.org/2001/XMLSchema#double',
    ]) {
      const r = renderTerm(
        { termType: 'Literal', value: '42', datatype: { value: dt } },
        EMPTY,
      );
      expect(r.kind).toBe('number');
      if (r.kind !== 'number') continue;
      expect(r.lexical).toBe('42');
      expect(r.datatype).toBe(dt);
    }
  });

  it('renders other typed literals as typed-literal with a rendered datatype', () => {
    const ctx: DisplayContext = {
      prefixes: { xsd: 'http://www.w3.org/2001/XMLSchema#' },
    };
    const r = renderTerm(
      {
        termType: 'Literal',
        value: '2024-01-01',
        datatype: { value: 'http://www.w3.org/2001/XMLSchema#date' },
      },
      ctx,
    );
    expect(r.kind).toBe('typed-literal');
    if (r.kind !== 'typed-literal') return;
    expect(r.lexical).toBe('2024-01-01');
    expect(r.datatype).toBe('http://www.w3.org/2001/XMLSchema#date');
    expect(r.datatypeDisplay.kind).toBe('prefixed-iri');
  });
});

describe('renderTerm — BlankNode', () => {
  it('renders a BlankNode as blank with a label', () => {
    const r = renderTerm({ termType: 'BlankNode', value: 'b0' }, EMPTY);
    expect(r.kind).toBe('blank');
    if (r.kind !== 'blank') return;
    expect(r.label).toBe('_:b0');
  });
});
