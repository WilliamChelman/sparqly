import { DataFactory } from 'n3';
import { describe, expect, it } from 'vitest';
import {
  parseDescribeWire,
  serializeDescribeWire,
} from './describe-wire-codec';

const { namedNode, blankNode, literal, defaultGraph, quad } = DataFactory;

describe('describeWire codec', () => {
  it('round-trips plain N-Quads (named-node subject/predicate/object, default graph)', () => {
    const q = quad(
      namedNode('http://example.org/alice'),
      namedNode('http://example.org/knows'),
      namedNode('http://example.org/bob'),
      defaultGraph(),
    );
    const wire = serializeDescribeWire([q]);
    const back = parseDescribeWire(wire);
    expect(back).toHaveLength(1);
    expect(back[0].subject.equals(q.subject)).toBe(true);
    expect(back[0].predicate.equals(q.predicate)).toBe(true);
    expect(back[0].object.equals(q.object)).toBe(true);
    expect(back[0].graph.termType).toBe('DefaultGraph');
  });

  it('round-trips named graphs', () => {
    const q = quad(
      namedNode('http://example.org/a'),
      namedNode('http://example.org/p'),
      namedNode('http://example.org/b'),
      namedNode('http://example.org/g'),
    );
    const wire = serializeDescribeWire([q]);
    const back = parseDescribeWire(wire);
    expect(back[0].graph.value).toBe('http://example.org/g');
  });

  it('round-trips blank nodes and literals (plain, lang-tagged, datatyped)', () => {
    const quads = [
      quad(
        blankNode('b1'),
        namedNode('http://example.org/p'),
        literal('hello'),
      ),
      quad(
        blankNode('b1'),
        namedNode('http://example.org/lang'),
        literal('bonjour', 'fr'),
      ),
      quad(
        blankNode('b1'),
        namedNode('http://example.org/age'),
        literal('30', namedNode('http://www.w3.org/2001/XMLSchema#integer')),
      ),
    ];
    const wire = serializeDescribeWire(quads);
    const back = parseDescribeWire(wire);
    expect(back).toHaveLength(3);
    expect(back[0].subject.termType).toBe('BlankNode');
    expect(back[0].object.value).toBe('hello');
    const langLit = back[1].object as import('n3').Literal;
    expect(langLit.language).toBe('fr');
    const dtLit = back[2].object as import('n3').Literal;
    expect(dtLit.datatype.value).toBe(
      'http://www.w3.org/2001/XMLSchema#integer',
    );
  });

  it('round-trips RDF-star quoted-triple subjects (annotation form)', () => {
    const inner = quad(
      namedNode('http://example.org/alice'),
      namedNode('http://example.org/knows'),
      namedNode('http://example.org/bob'),
    );
    const annotation = quad(
      inner,
      namedNode('urn:sparqly:fromSource'),
      literal('alpha'),
    );
    const wire = serializeDescribeWire([annotation]);
    const back = parseDescribeWire(wire);
    expect(back).toHaveLength(1);
    expect((back[0].subject.termType as string)).toBe('Quad');
    const reified = back[0].subject as unknown as import('n3').Quad;
    expect(reified.subject.value).toBe('http://example.org/alice');
    expect(reified.predicate.value).toBe('http://example.org/knows');
    expect(reified.object.value).toBe('http://example.org/bob');
    expect(back[0].object.value).toBe('alpha');
  });

  it('produces line-oriented output (one quad per line)', () => {
    const quads = [
      quad(
        namedNode('http://example.org/a'),
        namedNode('http://example.org/p'),
        namedNode('http://example.org/b'),
      ),
      quad(
        namedNode('http://example.org/c'),
        namedNode('http://example.org/p'),
        namedNode('http://example.org/d'),
      ),
    ];
    const wire = serializeDescribeWire(quads);
    const lines = wire.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('serializes an empty list as the empty string', () => {
    expect(serializeDescribeWire([])).toBe('');
    expect(parseDescribeWire('')).toEqual([]);
  });

  it('tolerates N-Triples line comments (e.g. Virtuoso\'s "# Empty NT")', () => {
    expect(parseDescribeWire('# Empty NT\n')).toEqual([]);
    const back = parseDescribeWire(
      '# header comment\n<http://example.org/a> <http://example.org/p> <http://example.org/b> . # trailing\n',
    );
    expect(back).toHaveLength(1);
    expect(back[0].subject.value).toBe('http://example.org/a');
  });

  it('decodes \\uXXXX / \\UXXXXXXXX numeric escapes in literals and IRIs', () => {
    const back = parseDescribeWire(
      '<http://example.org/caf\\u00E9> <http://example.org/p> "r\\u00E9sum\\u00E9 \\U0001F600" .\n',
    );
    expect(back).toHaveLength(1);
    expect(back[0].subject.value).toBe('http://example.org/café');
    expect(back[0].object.value).toBe('résumé \u{1F600}');
  });
});
