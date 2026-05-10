import type { SelectResult, Term } from '@app/core';
import { reifySelectSpo } from './select-spo-reifier';

const iri = (value: string): Term => ({ termType: 'NamedNode', value });
const bnode = (value: string): Term => ({ termType: 'BlankNode', value });
const lit = (value: string): Term => ({ termType: 'Literal', value });

function selectResult(
  variables: string[],
  bindings: ReadonlyArray<Record<string, Term>>,
): SelectResult {
  return {
    kind: 'select',
    variables,
    bindings,
    raw: '',
    contentType: 'application/sparql-results+json',
  };
}

describe('reifySelectSpo (shape detection)', () => {
  it('returns null when the projection is unrelated, e.g. {a,b,c}', () => {
    const r = selectResult(['a', 'b', 'c'], [
      { a: iri('http://ex/a'), b: iri('http://ex/b'), c: iri('http://ex/c') },
    ]);
    expect(reifySelectSpo(r)).toBeNull();
  });

  it('accepts {s,p,o} and reifies one row into one triple', () => {
    const r = selectResult(['s', 'p', 'o'], [
      { s: iri('http://ex/s'), p: iri('http://ex/p'), o: iri('http://ex/o') },
    ]);
    const out = reifySelectSpo(r);
    expect(out).toEqual([
      {
        subject: { termType: 'NamedNode', value: 'http://ex/s' },
        predicate: { termType: 'NamedNode', value: 'http://ex/p' },
        object: { termType: 'NamedNode', value: 'http://ex/o' },
      },
    ]);
  });

  it('accepts {s,p,o,g} and carries the graph through', () => {
    const r = selectResult(['s', 'p', 'o', 'g'], [
      {
        s: iri('http://ex/s'),
        p: iri('http://ex/p'),
        o: lit('v'),
        g: iri('http://ex/g'),
      },
    ]);
    const out = reifySelectSpo(r);
    expect(out).toEqual([
      {
        subject: { termType: 'NamedNode', value: 'http://ex/s' },
        predicate: { termType: 'NamedNode', value: 'http://ex/p' },
        object: { termType: 'Literal', value: 'v' },
        graph: { termType: 'NamedNode', value: 'http://ex/g' },
      },
    ]);
  });

  it('is position-independent: {p,s,o} is accepted just like {s,p,o}', () => {
    const r = selectResult(['p', 's', 'o'], [
      { s: iri('http://ex/s'), p: iri('http://ex/p'), o: iri('http://ex/o') },
    ]);
    const out = reifySelectSpo(r);
    expect(out).not.toBeNull();
    expect(out).toHaveLength(1);
  });

  it('rejects projections missing one of the required vars, e.g. {s,p}', () => {
    const r = selectResult(['s', 'p'], [
      { s: iri('http://ex/s'), p: iri('http://ex/p') },
    ]);
    expect(reifySelectSpo(r)).toBeNull();
  });

  it('rejects projections with an extra var, e.g. {s,p,o,extra}', () => {
    const r = selectResult(['s', 'p', 'o', 'extra'], [
      {
        s: iri('http://ex/s'),
        p: iri('http://ex/p'),
        o: iri('http://ex/o'),
        extra: lit('x'),
      },
    ]);
    expect(reifySelectSpo(r)).toBeNull();
  });
});

describe('reifySelectSpo (row-skip semantics)', () => {
  it('returns an empty array (not null) for empty input on a valid shape', () => {
    const r = selectResult(['s', 'p', 'o'], []);
    expect(reifySelectSpo(r)).toEqual([]);
  });

  it('skips rows where any of s, p, o is unbound', () => {
    const r = selectResult(['s', 'p', 'o'], [
      { p: iri('http://ex/p'), o: iri('http://ex/o') },
      { s: iri('http://ex/s'), o: iri('http://ex/o') },
      { s: iri('http://ex/s'), p: iri('http://ex/p') },
    ]);
    expect(reifySelectSpo(r)).toEqual([]);
  });

  it('skips rows whose predicate is not a NamedNode', () => {
    const r = selectResult(['s', 'p', 'o'], [
      { s: iri('http://ex/s'), p: bnode('b0'), o: iri('http://ex/o') },
      { s: iri('http://ex/s'), p: lit('p'), o: iri('http://ex/o') },
    ]);
    expect(reifySelectSpo(r)).toEqual([]);
  });

  it('skips rows whose subject is neither NamedNode nor BlankNode', () => {
    const r = selectResult(['s', 'p', 'o'], [
      { s: lit('s'), p: iri('http://ex/p'), o: iri('http://ex/o') },
    ]);
    expect(reifySelectSpo(r)).toEqual([]);
  });

  it('accepts a BlankNode subject', () => {
    const r = selectResult(['s', 'p', 'o'], [
      { s: bnode('b0'), p: iri('http://ex/p'), o: iri('http://ex/o') },
    ]);
    const out = reifySelectSpo(r);
    expect(out).toEqual([
      {
        subject: { termType: 'BlankNode', value: 'b0' },
        predicate: { termType: 'NamedNode', value: 'http://ex/p' },
        object: { termType: 'NamedNode', value: 'http://ex/o' },
      },
    ]);
  });

  it('skips rows in the 4-var case whose graph is neither NamedNode nor BlankNode', () => {
    const r = selectResult(['s', 'p', 'o', 'g'], [
      {
        s: iri('http://ex/s'),
        p: iri('http://ex/p'),
        o: iri('http://ex/o'),
        g: lit('g'),
      },
    ]);
    expect(reifySelectSpo(r)).toEqual([]);
  });

  it('skips rows in the 4-var case where the graph is unbound', () => {
    const r = selectResult(['s', 'p', 'o', 'g'], [
      { s: iri('http://ex/s'), p: iri('http://ex/p'), o: iri('http://ex/o') },
    ]);
    expect(reifySelectSpo(r)).toEqual([]);
  });

  it('returns only the valid subset when valid and invalid rows are mixed', () => {
    const r = selectResult(['s', 'p', 'o'], [
      // valid
      { s: iri('http://ex/s1'), p: iri('http://ex/p'), o: iri('http://ex/o1') },
      // invalid: literal predicate
      { s: iri('http://ex/s2'), p: lit('not-iri'), o: iri('http://ex/o2') },
      // invalid: unbound o
      { s: iri('http://ex/s3'), p: iri('http://ex/p') },
      // valid (blank-node subject)
      { s: bnode('b0'), p: iri('http://ex/p'), o: lit('v') },
    ]);
    const out = reifySelectSpo(r);
    expect(out).toHaveLength(2);
    expect(out?.[0].subject).toEqual({ termType: 'NamedNode', value: 'http://ex/s1' });
    expect(out?.[1].subject).toEqual({ termType: 'BlankNode', value: 'b0' });
  });
});
