import { DataFactory, Parser } from 'n3';
import { canonize } from 'rdf-canonize';
import { describe, expect, it } from 'vitest';
import { formatRdf } from './formatter';
import { parseRdfString } from './parse-rdf-string';
import { ttl } from './test/turtle';

const { namedNode, quad } = DataFactory;

describe('formatRdf', () => {
  it('returns an empty string for an empty quad iterable', () => {
    expect(formatRdf([], 'turtle', { prefixes: {} })).toBe('');
  });

  it('emits an IRI in full <...> form when no configured prefix matches', () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:a ex:p ex:b .
    `;
    const out = formatRdf(quads, 'turtle', { prefixes: {} });

    expect(out).toContain('<http://example.org/a>');
    expect(out).toContain('<http://example.org/p>');
    expect(out).toContain('<http://example.org/b>');
    expect(out).not.toMatch(/^@prefix /m);
    const parsed = new Parser({ format: 'text/turtle' }).parse(out);
    expect(parsed).toHaveLength(1);
  });

  it('shortens IRIs to CURIEs when a configured prefix matches', () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:a ex:p ex:b .
    `;
    const out = formatRdf(quads, 'turtle', {
      prefixes: { ex: 'http://example.org/' },
    });

    expect(out).toMatch(/^@prefix ex: <http:\/\/example\.org\/>\s*\.$/m);
    expect(out).toContain('ex:a');
    expect(out).toContain('ex:p');
    expect(out).toContain('ex:b');
    expect(out).not.toContain('<http://example.org/a>');
  });

  it('drops prefixes that are not used by any quad', () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:a ex:p ex:b .
    `;
    const out = formatRdf(quads, 'turtle', {
      prefixes: {
        ex: 'http://example.org/',
        unused: 'http://other.example/',
      },
    });

    expect(out).toContain('@prefix ex:');
    expect(out).not.toContain('@prefix unused:');
    expect(out).not.toContain('http://other.example/');
  });

  it('produces identical output regardless of input quad order', () => {
    const ex = 'http://example.org/';
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:b ex:p ex:z .
      ex:a ex:q ex:y .
      ex:a ex:p ex:x .
      ex:b ex:p ex:a .
    `;

    const a = formatRdf(quads, 'turtle', { prefixes: { ex } });
    const b = formatRdf([...quads].reverse(), 'turtle', { prefixes: { ex } });

    expect(a).toBe(b);
  });

  it('renders rdf:type as `a` and emits it before other predicates of the same subject', () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:s ex:p ex:o .
      ex:s a ex:T .
    `;
    const out = formatRdf(quads, 'turtle', {
      prefixes: { ex: 'http://example.org/' },
    });

    expect(out).toMatchInlineSnapshot(`
      "@prefix ex: <http://example.org/>.

      ex:s a ex:T;
          ex:p ex:o.
      "
    `);
  });

  describe('over the turtle corpus', () => {
    it('matches the golden snapshot for simple-prefix', () => {
      const fixture = TURTLE_CORPUS[0];
      const { quads, prefixes } = parseRdfString(fixture.turtle);
      const out = formatRdf(quads, 'turtle', { prefixes });

      expect(out).toMatchInlineSnapshot(`
        "@prefix ex: <http://example.org/>.

        ex:a a ex:Thing;
            ex:p ex:b.
        ex:c ex:p ex:d.
        "
      `);
    });

    for (const fixture of TURTLE_CORPUS) {
      const objectAnchoredPredicates = fixture.objectAnchoredPredicates;

      it(`is idempotent for ${fixture.name}`, () => {
        const parsed1 = parseRdfString(fixture.turtle);
        const out1 = formatRdf(parsed1.quads, 'turtle', {
          prefixes: parsed1.prefixes,
          base: parsed1.base,
          objectAnchoredPredicates,
        });
        const parsed2 = parseRdfString(out1);
        const out2 = formatRdf(parsed2.quads, 'turtle', {
          prefixes: parsed2.prefixes,
          base: parsed2.base,
          objectAnchoredPredicates,
        });
        expect(out2).toBe(out1);
      });

      it(`round-trips through canonicalization for ${fixture.name}`, async () => {
        const parsed = parseRdfString(fixture.turtle);
        const out = formatRdf(parsed.quads, 'turtle', {
          prefixes: parsed.prefixes,
          base: parsed.base,
          objectAnchoredPredicates,
        });
        const formatted = parseRdfString(out);
        const [originalCanon, formattedCanon] = await Promise.all([
          canonize(parsed.quads, {
            algorithm: 'RDFC-1.0',
            format: 'application/n-quads',
          }),
          canonize(formatted.quads, {
            algorithm: 'RDFC-1.0',
            format: 'application/n-quads',
          }),
        ]);
        expect(formattedCanon).toBe(originalCanon);
      });
    }
  });

  describe('rdf list compaction', () => {
    it('renders a well-formed rdf:first/rdf:rest/rdf:nil chain as ( ... )', () => {
      const { quads } = ttl`
        @prefix ex: <http://example.org/> .

        ex:s ex:p ( ex:a ex:b ex:c ) .
      `;
      const out = formatRdf(quads, 'turtle', {
        prefixes: { ex: 'http://example.org/' },
      });

      expect(out).toMatch(/\(\s*ex:a\s+ex:b\s+ex:c\s*\)/);
      expect(out).not.toContain('rdf:first');
      expect(out).not.toContain('rdf:rest');
    });

    it('keeps raw rdf:first/rdf:rest triples when the head is referenced more than once', () => {
      const rdfFirst = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
      const rdfRest = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest';
      const rdfNil = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil';
      const ex = 'http://example.org/';
      const head = DataFactory.blankNode('head');
      const tail = DataFactory.blankNode('tail');
      const triples = [
        // two external references to the head — disqualifies compaction
        quad(namedNode(ex + 's1'), namedNode(ex + 'p'), head),
        quad(namedNode(ex + 's2'), namedNode(ex + 'p'), head),
        // well-formed two-element list
        quad(head, namedNode(rdfFirst), namedNode(ex + 'a')),
        quad(head, namedNode(rdfRest), tail),
        quad(tail, namedNode(rdfFirst), namedNode(ex + 'b')),
        quad(tail, namedNode(rdfRest), namedNode(rdfNil)),
      ];
      const out = formatRdf(triples, 'turtle', { prefixes: { ex } });
      expect(out).toContain('first');
      expect(out).toContain('rest');
      expect(out).not.toMatch(/\(\s*ex:a\s+ex:b\s*\)/);
    });

    it('keeps raw triples when an intermediate node carries an extra predicate', () => {
      const rdfFirst = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
      const rdfRest = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest';
      const rdfNil = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil';
      const ex = 'http://example.org/';
      const head = DataFactory.blankNode('h');
      const tail = DataFactory.blankNode('t');
      const triples = [
        quad(namedNode(ex + 's'), namedNode(ex + 'p'), head),
        quad(head, namedNode(rdfFirst), namedNode(ex + 'a')),
        quad(head, namedNode(rdfRest), tail),
        // tail has rdf:first, rdf:rest, AND an extra predicate
        quad(tail, namedNode(rdfFirst), namedNode(ex + 'b')),
        quad(tail, namedNode(rdfRest), namedNode(rdfNil)),
        quad(tail, namedNode(ex + 'extra'), namedNode(ex + 'x')),
      ];
      const out = formatRdf(triples, 'turtle', { prefixes: { ex } });
      expect(out).toContain('first');
      expect(out).toContain('rest');
      expect(out).not.toMatch(/\(\s*ex:a\s+ex:b\s*\)/);
    });

    it('matches the golden snapshot for a well-formed list', () => {
      const { quads } = ttl`
        @prefix ex: <http://example.org/> .

        ex:s ex:p ( ex:a ex:b ex:c ) .
      `;
      const out = formatRdf(quads, 'turtle', {
        prefixes: { ex: 'http://example.org/' },
      });

      expect(out).toMatchInlineSnapshot(`
        "@prefix ex: <http://example.org/>.

        ex:s ex:p (ex:a ex:b ex:c).
        "
      `);
    });

    it('keeps raw triples when the chain does not terminate in rdf:nil', () => {
      const rdfFirst = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
      const rdfRest = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest';
      const ex = 'http://example.org/';
      const head = DataFactory.blankNode('h');
      const triples = [
        quad(namedNode(ex + 's'), namedNode(ex + 'p'), head),
        quad(head, namedNode(rdfFirst), namedNode(ex + 'a')),
        // rest points at a NamedNode that is NOT rdf:nil
        quad(head, namedNode(rdfRest), namedNode(ex + 'notNil')),
      ];
      const out = formatRdf(triples, 'turtle', { prefixes: { ex } });
      expect(out).toContain('first');
      expect(out).toContain('rest');
      expect(out).not.toMatch(/\(\s*ex:a\s*\)/);
    });
  });

  describe('anonymous blank node inlining', () => {
    it('inlines a single-use blank-node object as `[ ... ]`', () => {
      const { quads } = ttl`
        @prefix ex: <http://example.org/> .

        ex:s ex:p [ ex:q ex:o ] .
      `;
      const out = formatRdf(quads, 'turtle', {
        prefixes: { ex: 'http://example.org/' },
      });

      expect(out).toMatch(/ex:s\s+ex:p\s+\[/);
      expect(out).toContain('ex:q ex:o');
      expect(out).not.toMatch(/_:\w+\s+ex:q/);
      const parsed = new Parser({ format: 'text/turtle' }).parse(out);
      expect(parsed).toHaveLength(2);
    });

    it('keeps a labeled blank node when it is referenced more than once', () => {
      const { quads } = ttl`
        @prefix ex: <http://example.org/> .

        ex:s1 ex:p _:shared .
        ex:s2 ex:p _:shared .
        _:shared ex:q ex:o .
      `;
      const out = formatRdf(quads, 'turtle', {
        prefixes: { ex: 'http://example.org/' },
      });

      expect(out).toMatch(/_:\w+/);
      expect(out).not.toMatch(/ex:p\s*\[/);
      const parsed = new Parser({ format: 'text/turtle' }).parse(out);
      expect(parsed).toHaveLength(3);
    });

    it('inlines a single-use blank node with no own properties as `[]`', () => {
      const { quads } = ttl`
        @prefix ex: <http://example.org/> .

        ex:s ex:p [] .
      `;
      const out = formatRdf(quads, 'turtle', {
        prefixes: { ex: 'http://example.org/' },
      });

      expect(out).toMatch(/ex:s\s+ex:p\s+\[\s*\]/);
      expect(out).not.toMatch(/_:\w+/);
      const parsed = new Parser({ format: 'text/turtle' }).parse(out);
      expect(parsed).toHaveLength(1);
    });

    it('inlines nested single-use blank nodes', () => {
      const { quads } = ttl`
        @prefix ex: <http://example.org/> .

        ex:s ex:p [ ex:q [ ex:r ex:o ] ] .
      `;
      const out = formatRdf(quads, 'turtle', {
        prefixes: { ex: 'http://example.org/' },
      });

      expect(out).not.toMatch(/_:\w+/);
      expect(out).toMatch(/ex:s\s+ex:p\s+\[/);
      expect(out).toMatch(/ex:q\s+\[/);
      expect(out).toContain('ex:r ex:o');
      const parsed = new Parser({ format: 'text/turtle' }).parse(out);
      expect(parsed).toHaveLength(3);
    });

    it('does not inline a list head — list compaction wins', () => {
      const { quads } = ttl`
        @prefix ex: <http://example.org/> .

        ex:s ex:p ( ex:a ex:b ) .
      `;
      const out = formatRdf(quads, 'turtle', {
        prefixes: { ex: 'http://example.org/' },
      });

      expect(out).toMatch(/\(\s*ex:a\s+ex:b\s*\)/);
      expect(out).not.toContain('rdf:first');
      expect(out).not.toContain('rdf:rest');
      // No stray `_:` labels and no inline brackets `[`
      expect(out).not.toMatch(/_:\w+/);
      expect(out).not.toMatch(/ex:p\s+\[/);
    });

    it('emits objects of the same predicate in alphabetical order', () => {
      const { quads } = ttl`
        @prefix ex: <http://example.org/> .
        ex:s ex:p ex:z .
        ex:s ex:p ex:a .
        ex:s ex:p ex:m .
      `;
      const out = formatRdf(quads, 'turtle', {
        prefixes: { ex: 'http://example.org/' },
      });

      expect(out).toMatchInlineSnapshot(`
        "@prefix ex: <http://example.org/>.

        ex:s ex:p ex:a, ex:m, ex:z.
        "
      `);
    });
  });

  describe('object-anchored predicates', () => {
    const SH = 'http://www.w3.org/ns/shacl#';
    const ex = 'http://example.org/';

    it('emits the anchored triple immediately before the object\'s description block', () => {
      const { quads } = ttl`
        @prefix ex: <http://example.org/> .
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        ex:NS sh:property ex:PropShape .
        ex:NS a sh:NodeShape .
        ex:PropShape sh:path ex:name .
        ex:PropShape a sh:PropertyShape .
      `;
      const out = formatRdf(quads, 'turtle', {
        prefixes: { ex, sh: SH },
        objectAnchoredPredicates: [SH + 'property'],
      });

      expect(out).toMatchInlineSnapshot(`
        "@prefix ex: <http://example.org/>.
        @prefix sh: <http://www.w3.org/ns/shacl#>.

        ex:NS a sh:NodeShape.
        ex:NS sh:property ex:PropShape.
        ex:PropShape a sh:PropertyShape;
            sh:path ex:name.
        "
      `);
    });

    it('accepts CURIEs in the predicate list when the prefix is configured', () => {
      const { quads } = ttl`
        @prefix ex: <http://example.org/> .
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        ex:NS sh:property ex:PropShape .
        ex:PropShape sh:path ex:name .
      `;
      const out = formatRdf(quads, 'turtle', {
        prefixes: { ex, sh: SH },
        objectAnchoredPredicates: ['sh:property'],
      });

      expect(out).toMatchInlineSnapshot(`
        "@prefix ex: <http://example.org/>.
        @prefix sh: <http://www.w3.org/ns/shacl#>.

        ex:NS sh:property ex:PropShape.
        ex:PropShape sh:path ex:name.
        "
      `);
    });

    it('does not anchor when the object is a blank node — falls back to default placement', () => {
      const { quads } = ttl`
        @prefix ex: <http://example.org/> .
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        ex:NS sh:property [ sh:path ex:name ] .
      `;
      const out = formatRdf(quads, 'turtle', {
        prefixes: { ex, sh: SH },
        objectAnchoredPredicates: [SH + 'property'],
      });

      // Single-use blank-node inlining still applies — the property shape
      // becomes an inline `[ … ]` under ex:NS.
      expect(out).toMatch(/ex:NS\s+sh:property\s+\[/);
      expect(out).toMatch(/sh:path\s+ex:name/);
      expect(out).not.toMatch(/_:\w+/);
    });

    it('chains: an anchored object that is itself an anchor source places its own anchor next', () => {
      const { quads } = ttl`
        @prefix ex: <http://example.org/> .
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        ex:A sh:property ex:B .
        ex:A sh:targetClass ex:X .
        ex:B sh:property ex:C .
        ex:B sh:path ex:p1 .
        ex:C sh:path ex:p2 .
      `;
      const out = formatRdf(quads, 'turtle', {
        prefixes: { ex, sh: SH },
        objectAnchoredPredicates: [SH + 'property'],
      });

      expect(out).toMatchInlineSnapshot(`
        "@prefix ex: <http://example.org/>.
        @prefix sh: <http://www.w3.org/ns/shacl#>.

        ex:A sh:targetClass ex:X.
        ex:A sh:property ex:B.
        ex:B sh:path ex:p1.
        ex:B sh:property ex:C.
        ex:C sh:path ex:p2.
        "
      `);
    });

    it('groups multiple anchored references to the same object together, before the object\'s block', () => {
      const { quads } = ttl`
        @prefix ex: <http://example.org/> .
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        ex:NS1 sh:property ex:PropShape .
        ex:NS2 sh:property ex:PropShape .
        ex:PropShape sh:path ex:name .
      `;
      const out = formatRdf(quads, 'turtle', {
        prefixes: { ex, sh: SH },
        objectAnchoredPredicates: [SH + 'property'],
      });

      expect(out).toMatchInlineSnapshot(`
        "@prefix ex: <http://example.org/>.
        @prefix sh: <http://www.w3.org/ns/shacl#>.

        ex:NS1 sh:property ex:PropShape.
        ex:NS2 sh:property ex:PropShape.
        ex:PropShape sh:path ex:name.
        "
      `);

      // No duplication of the description.
      const matches = [...out.matchAll(/sh:path\s+ex:name/g)];
      expect(matches).toHaveLength(1);
    });
  });

  describe('@base handling', () => {
    it('emits @base and shortens matching absolute IRIs to relative form', () => {
      const { quads } = ttl`
        @base <http://example.org/> .
        <a> <p> <b> .
      `;
      const out = formatRdf(quads, 'turtle', {
        prefixes: {},
        base: 'http://example.org/',
      });

      expect(out).toMatch(/^@base <http:\/\/example\.org\/>\s*\.$/m);
      expect(out).not.toContain('<http://example.org/a>');
      expect(out).toContain('<a>');
      expect(out).toContain('<p>');
      expect(out).toContain('<b>');
      const parsed = new Parser({
        format: 'text/turtle',
        baseIRI: 'http://example.org/',
      }).parse(out);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].subject.value).toBe('http://example.org/a');
    });

    it('round-trips through canonicalization when a base is configured', async () => {
      const { quads: original } = ttl`
        @base <http://example.org/> .
        <a> <p> <b> .
      `;
      const out = formatRdf(original, 'turtle', {
        prefixes: {},
        base: 'http://example.org/',
      });
      const formatted = new Parser({
        format: 'text/turtle',
        baseIRI: 'http://example.org/',
      }).parse(out);
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
  });

  describe('trig output', () => {
    it('orders graph blocks alphabetically by graph IRI', () => {
      const { quads, prefixes } = ttl`
        @prefix ex: <http://example.org/> .

        ex:gZ { ex:s ex:p ex:o . }
        ex:gA { ex:s ex:p ex:o . }
        ex:gM { ex:s ex:p ex:o . }
      `;
      const out = formatRdf(quads, 'trig', { prefixes });

      expect(out).toMatchInlineSnapshot(`
        "@prefix ex: <http://example.org/>.

        ex:gA {
        ex:s ex:p ex:o
        }
        ex:gM {
        ex:s ex:p ex:o
        }
        ex:gZ {
        ex:s ex:p ex:o
        }
        "
      `);
    });

    it('matches the golden snapshot for two-named-graphs', () => {
      const { quads, prefixes } = parseRdfString(TRIG_CORPUS[0].trig);
      const out = formatRdf(quads, 'trig', { prefixes });

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
        const parsed1 = parseRdfString(fixture.trig);
        const out1 = formatRdf(parsed1.quads, 'trig', {
          prefixes: parsed1.prefixes,
        });
        const parsed2 = parseRdfString(out1);
        const out2 = formatRdf(parsed2.quads, 'trig', {
          prefixes: parsed2.prefixes,
        });
        expect(out2).toBe(out1);
      });

      it(`round-trips through canonicalization for ${fixture.name}`, async () => {
        const parsed = parseRdfString(fixture.trig);
        const out = formatRdf(parsed.quads, 'trig', {
          prefixes: parsed.prefixes,
        });
        const formatted = parseRdfString(out);
        const [originalCanon, formattedCanon] = await Promise.all([
          canonize(parsed.quads, {
            algorithm: 'RDFC-1.0',
            format: 'application/n-quads',
          }),
          canonize(formatted.quads, {
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
  {
    name: 'anonymous-bn-in-named-graph',
    trig: [
      '@prefix ex: <http://example.org/> .',
      '',
      'ex:g1 { ex:s ex:p [ ex:q ex:o ] . }',
      'ex:g2 { ex:t ex:p _:shared . _:shared ex:r ex:x . _:other ex:r ex:y . _:shared ex:r2 _:other . }',
      '',
    ].join('\n'),
  },
];

const TURTLE_CORPUS: ReadonlyArray<{
  name: string;
  turtle: string;
  objectAnchoredPredicates?: string[];
}> = [
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
  {
    name: 'with-base',
    turtle: [
      '@base <http://example.org/> .',
      '@prefix ex: <http://example.org/> .',
      '',
      '<a> ex:p <b> .',
      '<c> ex:p <d> .',
      '',
    ].join('\n'),
  },
  {
    name: 'well-formed-list',
    turtle: [
      '@prefix ex: <http://example.org/> .',
      '',
      'ex:s ex:p ( ex:a ex:b ex:c ) .',
      '',
    ].join('\n'),
  },
  {
    name: 'list-with-shared-head',
    turtle: [
      '@prefix ex: <http://example.org/> .',
      '@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .',
      '',
      // head is referenced twice — must stay raw
      'ex:s1 ex:p _:h .',
      'ex:s2 ex:p _:h .',
      '_:h rdf:first ex:a ; rdf:rest _:t .',
      '_:t rdf:first ex:b ; rdf:rest rdf:nil .',
      '',
    ].join('\n'),
  },
  {
    name: 'list-with-extra-predicate-on-tail',
    turtle: [
      '@prefix ex: <http://example.org/> .',
      '@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .',
      '',
      // tail node carries an extra predicate — must stay raw
      'ex:s ex:p _:h .',
      '_:h rdf:first ex:a ; rdf:rest _:t .',
      '_:t rdf:first ex:b ; rdf:rest rdf:nil ; ex:extra ex:x .',
      '',
    ].join('\n'),
  },
  {
    name: 'single-use-blank-node',
    turtle: [
      '@prefix ex: <http://example.org/> .',
      '',
      'ex:s ex:p [ ex:q ex:o ; ex:r "hello" ] .',
      '',
    ].join('\n'),
  },
  {
    name: 'multi-ref-blank-node',
    turtle: [
      '@prefix ex: <http://example.org/> .',
      '',
      'ex:s1 ex:p _:shared .',
      'ex:s2 ex:p _:shared .',
      '_:shared ex:q ex:o .',
      '',
    ].join('\n'),
  },
  {
    name: 'nested-anonymous-blank-nodes',
    turtle: [
      '@prefix ex: <http://example.org/> .',
      '',
      'ex:s ex:p [ ex:q [ ex:r ex:o ] ; ex:s ex:t ] .',
      '',
    ].join('\n'),
  },
  {
    name: 'rdf-type-with-anonymous-bn',
    turtle: [
      '@prefix ex: <http://example.org/> .',
      '',
      'ex:s a ex:Thing ; ex:p [ a ex:Inner ; ex:q ex:o ] .',
      '',
    ].join('\n'),
  },
  {
    name: 'list-not-terminated-by-nil',
    turtle: [
      '@prefix ex: <http://example.org/> .',
      '@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .',
      '',
      // chain points at a NamedNode that is not rdf:nil — must stay raw
      'ex:s ex:p _:h .',
      '_:h rdf:first ex:a ; rdf:rest ex:notNil .',
      '',
    ].join('\n'),
  },
  {
    name: 'shacl-named-property-shapes-anchored',
    objectAnchoredPredicates: ['http://www.w3.org/ns/shacl#property'],
    turtle: [
      '@prefix ex: <http://example.org/> .',
      '@prefix sh: <http://www.w3.org/ns/shacl#> .',
      '',
      'ex:NS a sh:NodeShape ;',
      '  sh:property ex:NameProp ;',
      '  sh:property ex:AgeProp .',
      'ex:NameProp a sh:PropertyShape ; sh:path ex:name .',
      'ex:AgeProp a sh:PropertyShape ; sh:path ex:age .',
      '',
    ].join('\n'),
  },
  {
    name: 'shacl-shared-named-property-shape-anchored',
    objectAnchoredPredicates: ['http://www.w3.org/ns/shacl#property'],
    turtle: [
      '@prefix ex: <http://example.org/> .',
      '@prefix sh: <http://www.w3.org/ns/shacl#> .',
      '',
      'ex:NS1 sh:property ex:Shared .',
      'ex:NS2 sh:property ex:Shared .',
      'ex:Shared sh:path ex:name .',
      '',
    ].join('\n'),
  },
];
