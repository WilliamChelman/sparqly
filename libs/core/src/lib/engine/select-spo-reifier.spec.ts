import type * as RDF from '@rdfjs/types';
import { DataFactory } from 'n3';
import { describe, expect, it } from 'vitest';
import { reifyTripleShapedBindings } from './select-spo-reifier';

const { namedNode, blankNode, literal } = DataFactory;

function row(entries: Record<string, RDF.Term>): Record<string, RDF.Term> {
  return entries;
}

describe('reifyTripleShapedBindings — shape detection', () => {
  it('returns null when the projection is unrelated (e.g. {a,b,c})', () => {
    const out = reifyTripleShapedBindings({
      variables: ['a', 'b', 'c'],
      bindings: [
        row({
          a: namedNode('http://ex/a'),
          b: namedNode('http://ex/b'),
          c: namedNode('http://ex/c'),
        }),
      ],
    });
    expect(out).toBeNull();
  });

  it('is position-independent for both shapes', () => {
    const spo = reifyTripleShapedBindings({
      variables: ['p', 's', 'o'],
      bindings: [
        row({
          s: namedNode('http://ex/s'),
          p: namedNode('http://ex/p'),
          o: namedNode('http://ex/o'),
        }),
      ],
    });
    expect(spo).toHaveLength(1);
    const spog = reifyTripleShapedBindings({
      variables: ['g', 'o', 'p', 's'],
      bindings: [
        row({
          s: namedNode('http://ex/s'),
          p: namedNode('http://ex/p'),
          o: namedNode('http://ex/o'),
          g: namedNode('http://ex/g'),
        }),
      ],
    });
    expect(spog).toHaveLength(1);
    expect((spog as RDF.Quad[])[0].graph.value).toBe('http://ex/g');
  });

  it('rejects projections with the wrong arity (e.g. {s,p} or {s,p,o,extra})', () => {
    const tooFew = reifyTripleShapedBindings({
      variables: ['s', 'p'],
      bindings: [],
    });
    expect(tooFew).toBeNull();
    const tooMany = reifyTripleShapedBindings({
      variables: ['s', 'p', 'o', 'extra'],
      bindings: [],
    });
    expect(tooMany).toBeNull();
  });

  it('accepts a BlankNode subject and a BlankNode graph', () => {
    const out = reifyTripleShapedBindings({
      variables: ['s', 'p', 'o', 'g'],
      bindings: [
        row({
          s: blankNode('b0'),
          p: namedNode('http://ex/p'),
          o: namedNode('http://ex/o'),
          g: blankNode('bg'),
        }),
      ],
    });
    expect(out).toHaveLength(1);
    const q = (out as RDF.Quad[])[0];
    expect(q.subject.termType).toBe('BlankNode');
    expect(q.graph.termType).toBe('BlankNode');
  });

  it('skips rows whose predicate is not a NamedNode (literal or blank)', () => {
    const out = reifyTripleShapedBindings({
      variables: ['s', 'p', 'o'],
      bindings: [
        row({
          s: namedNode('http://ex/s'),
          p: literal('not-iri'),
          o: namedNode('http://ex/o'),
        }),
        row({
          s: namedNode('http://ex/s'),
          p: blankNode('b0'),
          o: namedNode('http://ex/o'),
        }),
      ],
    });
    expect(out).toEqual([]);
  });

  it('skips rows whose subject is a Literal', () => {
    const out = reifyTripleShapedBindings({
      variables: ['s', 'p', 'o'],
      bindings: [
        row({
          s: literal('s'),
          p: namedNode('http://ex/p'),
          o: namedNode('http://ex/o'),
        }),
      ],
    });
    expect(out).toEqual([]);
  });

  it('skips rows where any of ?s, ?p, ?o is unbound', () => {
    const out = reifyTripleShapedBindings({
      variables: ['s', 'p', 'o'],
      bindings: [
        row({ p: namedNode('http://ex/p'), o: namedNode('http://ex/o') }),
        row({ s: namedNode('http://ex/s'), o: namedNode('http://ex/o') }),
        row({ s: namedNode('http://ex/s'), p: namedNode('http://ex/p') }),
      ],
    });
    expect(out).toEqual([]);
  });

  it('skips rows in the 4-var case whose ?g is a Literal', () => {
    const out = reifyTripleShapedBindings({
      variables: ['s', 'p', 'o', 'g'],
      bindings: [
        row({
          s: namedNode('http://ex/s'),
          p: namedNode('http://ex/p'),
          o: namedNode('http://ex/o'),
          g: literal('g'),
        }),
      ],
    });
    expect(out).toEqual([]);
  });

  it('promotes rows with unbound ?g to the default graph (not dropped) in the 4-var case', () => {
    const out = reifyTripleShapedBindings({
      variables: ['s', 'p', 'o', 'g'],
      bindings: [
        row({
          s: namedNode('http://ex/s'),
          p: namedNode('http://ex/p'),
          o: namedNode('http://ex/o'),
          // ?g intentionally absent
        }),
      ],
    });
    expect(out).toHaveLength(1);
    expect((out as RDF.Quad[])[0].graph.termType).toBe('DefaultGraph');
  });

  it('accepts {s,p,o,g} and carries the named graph through', () => {
    const out = reifyTripleShapedBindings({
      variables: ['s', 'p', 'o', 'g'],
      bindings: [
        row({
          s: namedNode('http://ex/s'),
          p: namedNode('http://ex/p'),
          o: literal('v'),
          g: namedNode('http://ex/g'),
        }),
      ],
    });
    expect(out).not.toBeNull();
    expect(out).toHaveLength(1);
    const q = (out as RDF.Quad[])[0];
    expect(q.subject.value).toBe('http://ex/s');
    expect(q.object.termType).toBe('Literal');
    expect(q.graph.termType).toBe('NamedNode');
    expect(q.graph.value).toBe('http://ex/g');
  });

  it('accepts {s,p,o} and reifies one row into one quad in the default graph', () => {
    const out = reifyTripleShapedBindings({
      variables: ['s', 'p', 'o'],
      bindings: [
        row({
          s: namedNode('http://ex/s'),
          p: namedNode('http://ex/p'),
          o: namedNode('http://ex/o'),
        }),
      ],
    });
    expect(out).not.toBeNull();
    expect(out).toHaveLength(1);
    const q = (out as RDF.Quad[])[0];
    expect(q.subject.value).toBe('http://ex/s');
    expect(q.predicate.value).toBe('http://ex/p');
    expect(q.object.value).toBe('http://ex/o');
    expect(q.graph.termType).toBe('DefaultGraph');
  });
});
