import { DataFactory } from 'n3';
import { describe, expect, it } from 'vitest';
import { describeProvenance } from './describe-provenance';

const { namedNode, literal, quad, defaultGraph, blankNode } = DataFactory;

const FROM_SOURCE = 'urn:sparqly:fromSource';

const aliceKnowsBob = quad(
  namedNode('http://example.org/alice'),
  namedNode('http://example.org/knows'),
  namedNode('http://example.org/bob'),
  defaultGraph(),
);

describe('describeProvenance.inject', () => {
  it('emits one RDF-star annotation per quad with the source id as a string-literal object', () => {
    const out = describeProvenance.inject([aliceKnowsBob], 'alpha', FROM_SOURCE);

    // Original quad + 1 annotation.
    expect(out).toHaveLength(2);
    const annotation = out.find(
      (q) => (q.subject.termType as string) === 'Quad',
    );
    expect(annotation).toBeDefined();
    expect(annotation?.predicate.value).toBe(FROM_SOURCE);
    expect(annotation?.object.termType).toBe('Literal');
    expect(annotation?.object.value).toBe('alpha');
  });

  it("annotation's quoted-triple subject matches the original (s, p, o, g)", () => {
    const out = describeProvenance.inject([aliceKnowsBob], 'alpha', FROM_SOURCE);
    const annotation = out.find(
      (q) => (q.subject.termType as string) === 'Quad',
    );
    expect(annotation).toBeDefined();
    const reified = annotation?.subject as unknown as import('n3').Quad;
    expect(reified.subject.equals(aliceKnowsBob.subject)).toBe(true);
    expect(reified.predicate.equals(aliceKnowsBob.predicate)).toBe(true);
    expect(reified.object.equals(aliceKnowsBob.object)).toBe(true);
  });

  it('uses the predicate IRI passed in (not hardcoded)', () => {
    const custom = 'http://my/from';
    const out = describeProvenance.inject([aliceKnowsBob], 'alpha', custom);
    const annotation = out.find(
      (q) => (q.subject.termType as string) === 'Quad',
    );
    expect(annotation?.predicate.value).toBe(custom);
  });
});

describe('describeProvenance.strip', () => {
  it('splits annotations off the quad stream and returns originsByQuad', () => {
    const injected = describeProvenance.inject(
      [aliceKnowsBob],
      'alpha',
      FROM_SOURCE,
    );

    const { quads, originsByQuad } = describeProvenance.strip(
      injected,
      FROM_SOURCE,
    );

    expect(quads).toHaveLength(1);
    expect(
      quads.every(
        (q) => (q.subject.termType as string) !== 'Quad' || q.predicate.value !== FROM_SOURCE,
      ),
    ).toBe(true);
    // origins map keyed on the strip-mode quad-key.
    const origins = [...originsByQuad.values()][0];
    expect(origins).toEqual(['alpha']);
  });

  it('strips only annotations with the matching predicate; leaves user RDF-star intact', () => {
    const userAnnotation = quad(
      quad(
        namedNode('http://example.org/alice'),
        namedNode('http://example.org/knows'),
        namedNode('http://example.org/bob'),
      ),
      namedNode('http://example.org/source'),
      literal('wiki'),
    );
    const injected = describeProvenance.inject(
      [aliceKnowsBob, userAnnotation],
      'alpha',
      FROM_SOURCE,
    );

    const { quads } = describeProvenance.strip(injected, FROM_SOURCE);
    // Original quad + user-authored RDF-star, but NOT the provenance annotation.
    expect(quads).toHaveLength(2);
    const preds = quads.map((q) => q.predicate.value).sort();
    expect(preds).toEqual([
      'http://example.org/knows',
      'http://example.org/source',
    ]);
  });

  it('aggregates multiple provenance annotations on the same quad into a list of origins', () => {
    const alphaInjected = describeProvenance.inject(
      [aliceKnowsBob],
      'alpha',
      FROM_SOURCE,
    );
    const betaInjected = describeProvenance.inject(
      [aliceKnowsBob],
      'beta',
      FROM_SOURCE,
    );
    // Same lexical quad annotated twice (post-merge dedup scenario).
    const merged = [...alphaInjected, ...betaInjected.filter((q) => (q.subject.termType as string) === 'Quad')];

    const { quads, originsByQuad } = describeProvenance.strip(merged, FROM_SOURCE);
    expect(quads).toHaveLength(1);
    const origins = [...originsByQuad.values()][0];
    expect([...origins].sort()).toEqual(['alpha', 'beta']);
  });
});

describe('describeProvenance round-trip', () => {
  it('inject then strip returns the original quad set with the originating source on every quad', () => {
    const original = [
      aliceKnowsBob,
      quad(
        namedNode('http://example.org/alice'),
        namedNode('http://example.org/age'),
        literal('30'),
        defaultGraph(),
      ),
      quad(
        blankNode('b1'),
        namedNode('http://example.org/p'),
        literal('x'),
        defaultGraph(),
      ),
    ];

    const injected = describeProvenance.inject(original, 'src', FROM_SOURCE);
    const { quads, originsByQuad } = describeProvenance.strip(injected, FROM_SOURCE);

    // Every original quad survives the round-trip.
    expect(quads).toHaveLength(original.length);
    // Every quad has 'src' in its origins.
    for (const origins of originsByQuad.values()) {
      expect(origins).toEqual(['src']);
    }
  });
});
