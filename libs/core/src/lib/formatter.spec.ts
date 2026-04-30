import { DataFactory, Parser } from 'n3';
import { canonize } from 'rdf-canonize';
import { describe, expect, it } from 'vitest';
import { formatRdf } from './formatter';

const { namedNode, quad } = DataFactory;

describe('formatRdf', () => {
  it('returns an empty string for an empty quad iterable', () => {
    expect(formatRdf([], 'turtle', { prefixes: {} })).toBe('');
  });

  it('emits an IRI in full <...> form when no configured prefix matches', () => {
    const out = formatRdf(
      [
        quad(
          namedNode('http://example.org/a'),
          namedNode('http://example.org/p'),
          namedNode('http://example.org/b'),
        ),
      ],
      'turtle',
      { prefixes: {} },
    );

    expect(out).toContain('<http://example.org/a>');
    expect(out).toContain('<http://example.org/p>');
    expect(out).toContain('<http://example.org/b>');
    expect(out).not.toMatch(/^@prefix /m);
    const parsed = new Parser({ format: 'text/turtle' }).parse(out);
    expect(parsed).toHaveLength(1);
  });

  it('shortens IRIs to CURIEs when a configured prefix matches', () => {
    const out = formatRdf(
      [
        quad(
          namedNode('http://example.org/a'),
          namedNode('http://example.org/p'),
          namedNode('http://example.org/b'),
        ),
      ],
      'turtle',
      { prefixes: { ex: 'http://example.org/' } },
    );

    expect(out).toMatch(/^@prefix ex: <http:\/\/example\.org\/>\s*\.$/m);
    expect(out).toContain('ex:a');
    expect(out).toContain('ex:p');
    expect(out).toContain('ex:b');
    expect(out).not.toContain('<http://example.org/a>');
  });

  it('drops prefixes that are not used by any quad', () => {
    const out = formatRdf(
      [
        quad(
          namedNode('http://example.org/a'),
          namedNode('http://example.org/p'),
          namedNode('http://example.org/b'),
        ),
      ],
      'turtle',
      {
        prefixes: {
          ex: 'http://example.org/',
          unused: 'http://other.example/',
        },
      },
    );

    expect(out).toContain('@prefix ex:');
    expect(out).not.toContain('@prefix unused:');
    expect(out).not.toContain('http://other.example/');
  });

  it('produces identical output regardless of input quad order', () => {
    const ex = 'http://example.org/';
    const triples = [
      quad(namedNode(ex + 'b'), namedNode(ex + 'p'), namedNode(ex + 'z')),
      quad(namedNode(ex + 'a'), namedNode(ex + 'q'), namedNode(ex + 'y')),
      quad(namedNode(ex + 'a'), namedNode(ex + 'p'), namedNode(ex + 'x')),
      quad(namedNode(ex + 'b'), namedNode(ex + 'p'), namedNode(ex + 'a')),
    ];

    const a = formatRdf(triples, 'turtle', { prefixes: { ex } });
    const b = formatRdf([...triples].reverse(), 'turtle', { prefixes: { ex } });

    expect(a).toBe(b);
  });

  it('renders rdf:type as `a` and emits it before other predicates of the same subject', () => {
    const ex = 'http://example.org/';
    const rdfType = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
    const out = formatRdf(
      [
        quad(namedNode(ex + 's'), namedNode(ex + 'p'), namedNode(ex + 'o')),
        quad(namedNode(ex + 's'), namedNode(rdfType), namedNode(ex + 'T')),
      ],
      'turtle',
      { prefixes: { ex } },
    );

    const aIdx = out.indexOf(' a ');
    const pIdx = out.indexOf('ex:p');
    expect(aIdx).toBeGreaterThan(-1);
    expect(pIdx).toBeGreaterThan(-1);
    expect(aIdx).toBeLessThan(pIdx);
    expect(out).not.toContain('rdf:type');
  });

  describe('over the turtle corpus', () => {
    it('matches the golden snapshot for simple-prefix', () => {
      const fixture = TURTLE_CORPUS[0];
      const quads = new Parser({ format: 'text/turtle' }).parse(fixture.turtle);
      const out = formatRdf(quads, 'turtle', {
        prefixes: parsePrefixes(fixture.turtle),
      });

      expect(out).toMatchInlineSnapshot(`
        "@prefix ex: <http://example.org/>.

        ex:a a ex:Thing;
            ex:p ex:b.
        ex:c ex:p ex:d.
        "
      `);
    });

    for (const fixture of TURTLE_CORPUS) {
      it(`is idempotent for ${fixture.name}`, () => {
        const quads1 = new Parser({ format: 'text/turtle' }).parse(
          fixture.turtle,
        );
        const out1 = formatRdf(quads1, 'turtle', {
          prefixes: parsePrefixes(fixture.turtle),
        });
        const quads2 = new Parser({ format: 'text/turtle' }).parse(out1);
        const out2 = formatRdf(quads2, 'turtle', {
          prefixes: parsePrefixes(out1),
        });
        expect(out2).toBe(out1);
      });

      it(`round-trips through canonicalization for ${fixture.name}`, async () => {
        const original = new Parser({ format: 'text/turtle' }).parse(
          fixture.turtle,
        );
        const out = formatRdf(original, 'turtle', {
          prefixes: parsePrefixes(fixture.turtle),
        });
        const formatted = new Parser({ format: 'text/turtle' }).parse(out);
        const [originalCanon, formattedCanon] = await Promise.all([
          canonize(original, {
            algorithm: 'RDFC-1.0',
            format: 'application/n-quads',
          }),
          canonize(formatted, {
            algorithm: 'RDFC-1.0',
            format: 'application/n-quads',
          }),
        ]);
        expect(formattedCanon).toBe(originalCanon);
      });
    }
  });

  describe('trig output', () => {
    it('orders graph blocks alphabetically by graph IRI', () => {
      const trig = [
        '@prefix ex: <http://example.org/> .',
        '',
        'ex:gZ { ex:s ex:p ex:o . }',
        'ex:gA { ex:s ex:p ex:o . }',
        'ex:gM { ex:s ex:p ex:o . }',
        '',
      ].join('\n');
      const quads = new Parser({ format: 'application/trig' }).parse(trig);
      const out = formatRdf(quads, 'trig', {
        prefixes: parsePrefixes(trig, 'application/trig'),
      });

      const aIdx = out.indexOf('ex:gA');
      const mIdx = out.indexOf('ex:gM');
      const zIdx = out.indexOf('ex:gZ');
      expect(aIdx).toBeGreaterThan(-1);
      expect(mIdx).toBeGreaterThan(-1);
      expect(zIdx).toBeGreaterThan(-1);
      expect(aIdx).toBeLessThan(mIdx);
      expect(mIdx).toBeLessThan(zIdx);
    });

    it('matches the golden snapshot for two-named-graphs', () => {
      const trig = TRIG_CORPUS[0].trig;
      const quads = new Parser({ format: 'application/trig' }).parse(trig);
      const out = formatRdf(quads, 'trig', {
        prefixes: parsePrefixes(trig, 'application/trig'),
      });

      expect(out).toMatchInlineSnapshot(`
        "@prefix ex: <http://example.org/>.

        ex:g1 {
        ex:a ex:p ex:b
        }
        ex:g2 {
        ex:c ex:q ex:d
        }
        "
      `);
    });

    for (const fixture of TRIG_CORPUS) {
      it(`is idempotent for ${fixture.name}`, () => {
        const quads1 = new Parser({ format: 'application/trig' }).parse(
          fixture.trig,
        );
        const out1 = formatRdf(quads1, 'trig', {
          prefixes: parsePrefixes(fixture.trig, 'application/trig'),
        });
        const quads2 = new Parser({ format: 'application/trig' }).parse(out1);
        const out2 = formatRdf(quads2, 'trig', {
          prefixes: parsePrefixes(out1, 'application/trig'),
        });
        expect(out2).toBe(out1);
      });

      it(`round-trips through canonicalization for ${fixture.name}`, async () => {
        const original = new Parser({ format: 'application/trig' }).parse(
          fixture.trig,
        );
        const out = formatRdf(original, 'trig', {
          prefixes: parsePrefixes(fixture.trig, 'application/trig'),
        });
        const formatted = new Parser({ format: 'application/trig' }).parse(out);
        const [originalCanon, formattedCanon] = await Promise.all([
          canonize(original, {
            algorithm: 'RDFC-1.0',
            format: 'application/n-quads',
          }),
          canonize(formatted, {
            algorithm: 'RDFC-1.0',
            format: 'application/n-quads',
          }),
        ]);
        expect(formattedCanon).toBe(originalCanon);
      });
    }
  });
});

const TRIG_CORPUS: ReadonlyArray<{ name: string; trig: string }> = [
  {
    name: 'two-named-graphs',
    trig: [
      '@prefix ex: <http://example.org/> .',
      '',
      'ex:g1 { ex:a ex:p ex:b . }',
      'ex:g2 { ex:c ex:q ex:d . }',
      '',
    ].join('\n'),
  },
  {
    name: 'default-and-named-graph',
    trig: [
      '@prefix ex: <http://example.org/> .',
      '',
      'ex:a ex:p ex:b .',
      'ex:g { ex:c ex:q ex:d . }',
      '',
    ].join('\n'),
  },
];

const TURTLE_CORPUS: ReadonlyArray<{ name: string; turtle: string }> = [
  {
    name: 'simple-prefix',
    turtle: [
      '@prefix ex: <http://example.org/> .',
      '@prefix unused: <http://other.example/> .',
      '',
      'ex:c ex:p ex:d .',
      'ex:a ex:p ex:b .',
      'ex:a a ex:Thing .',
      '',
    ].join('\n'),
  },
  {
    name: 'mixed-known-and-unknown-iris',
    turtle: [
      '@prefix ex: <http://example.org/> .',
      '',
      'ex:a ex:p <http://other.example/x> .',
      '<http://yet-another.example/s> ex:p ex:b .',
      '',
    ].join('\n'),
  },
  {
    name: 'literals',
    turtle: [
      '@prefix ex: <http://example.org/> .',
      '',
      'ex:a ex:p "hello" .',
      'ex:a ex:p "bonjour"@fr .',
      'ex:a ex:p 42 .',
      '',
    ].join('\n'),
  },
];

function parsePrefixes(
  text: string,
  format: 'text/turtle' | 'application/trig' = 'text/turtle',
): Record<string, string> {
  const prefixes: Record<string, string> = {};
  const parser = new Parser({ format });
  parser.parse(text, undefined, (prefix, iri) => {
    if (prefix && iri) prefixes[prefix] = (iri as { value: string }).value;
  });
  return prefixes;
}
