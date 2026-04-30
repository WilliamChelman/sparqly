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
      const objectAnchoredPredicates = fixture.objectAnchoredPredicates;

      it(`is idempotent for ${fixture.name}`, () => {
        const base = parseBase(fixture.turtle);
        const quads1 = new Parser({
          format: 'text/turtle',
          baseIRI: base,
        }).parse(fixture.turtle);
        const out1 = formatRdf(quads1, 'turtle', {
          prefixes: parsePrefixes(fixture.turtle),
          base,
          objectAnchoredPredicates,
        });
        const quads2 = new Parser({
          format: 'text/turtle',
          baseIRI: base,
        }).parse(out1);
        const out2 = formatRdf(quads2, 'turtle', {
          prefixes: parsePrefixes(out1),
          base: parseBase(out1),
          objectAnchoredPredicates,
        });
        expect(out2).toBe(out1);
      });

      it(`round-trips through canonicalization for ${fixture.name}`, async () => {
        const base = parseBase(fixture.turtle);
        const original = new Parser({
          format: 'text/turtle',
          baseIRI: base,
        }).parse(fixture.turtle);
        const out = formatRdf(original, 'turtle', {
          prefixes: parsePrefixes(fixture.turtle),
          base,
          objectAnchoredPredicates,
        });
        const formatted = new Parser({
          format: 'text/turtle',
          baseIRI: base,
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
    }
  });

  describe('rdf list compaction', () => {
    it('renders a well-formed rdf:first/rdf:rest/rdf:nil chain as ( ... )', () => {
      const turtle = [
        '@prefix ex: <http://example.org/> .',
        '',
        'ex:s ex:p ( ex:a ex:b ex:c ) .',
        '',
      ].join('\n');
      const quads = new Parser({ format: 'text/turtle' }).parse(turtle);
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
      const turtle = [
        '@prefix ex: <http://example.org/> .',
        '',
        'ex:s ex:p ( ex:a ex:b ex:c ) .',
        '',
      ].join('\n');
      const quads = new Parser({ format: 'text/turtle' }).parse(turtle);
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
      const ex = 'http://example.org/';
      const b = DataFactory.blankNode('x');
      const triples = [
        quad(namedNode(ex + 's'), namedNode(ex + 'p'), b),
        quad(b, namedNode(ex + 'q'), namedNode(ex + 'o')),
      ];
      const out = formatRdf(triples, 'turtle', { prefixes: { ex } });

      expect(out).toMatch(/ex:s\s+ex:p\s+\[/);
      expect(out).toContain('ex:q ex:o');
      expect(out).not.toMatch(/_:\w+\s+ex:q/);
      const parsed = new Parser({ format: 'text/turtle' }).parse(out);
      expect(parsed).toHaveLength(2);
    });

    it('keeps a labeled blank node when it is referenced more than once', () => {
      const ex = 'http://example.org/';
      const b = DataFactory.blankNode('shared');
      const triples = [
        quad(namedNode(ex + 's1'), namedNode(ex + 'p'), b),
        quad(namedNode(ex + 's2'), namedNode(ex + 'p'), b),
        quad(b, namedNode(ex + 'q'), namedNode(ex + 'o')),
      ];
      const out = formatRdf(triples, 'turtle', { prefixes: { ex } });

      expect(out).toMatch(/_:\w+/);
      expect(out).not.toMatch(/ex:p\s*\[/);
      const parsed = new Parser({ format: 'text/turtle' }).parse(out);
      expect(parsed).toHaveLength(3);
    });

    it('inlines a single-use blank node with no own properties as `[]`', () => {
      const ex = 'http://example.org/';
      const b = DataFactory.blankNode('lonely');
      const triples = [
        quad(namedNode(ex + 's'), namedNode(ex + 'p'), b),
      ];
      const out = formatRdf(triples, 'turtle', { prefixes: { ex } });

      expect(out).toMatch(/ex:s\s+ex:p\s+\[\s*\]/);
      expect(out).not.toMatch(/_:\w+/);
      const parsed = new Parser({ format: 'text/turtle' }).parse(out);
      expect(parsed).toHaveLength(1);
    });

    it('inlines nested single-use blank nodes', () => {
      const ex = 'http://example.org/';
      const b1 = DataFactory.blankNode('a');
      const b2 = DataFactory.blankNode('b');
      const triples = [
        quad(namedNode(ex + 's'), namedNode(ex + 'p'), b1),
        quad(b1, namedNode(ex + 'q'), b2),
        quad(b2, namedNode(ex + 'r'), namedNode(ex + 'o')),
      ];
      const out = formatRdf(triples, 'turtle', { prefixes: { ex } });

      expect(out).not.toMatch(/_:\w+/);
      expect(out).toMatch(/ex:s\s+ex:p\s+\[/);
      expect(out).toMatch(/ex:q\s+\[/);
      expect(out).toContain('ex:r ex:o');
      const parsed = new Parser({ format: 'text/turtle' }).parse(out);
      expect(parsed).toHaveLength(3);
    });

    it('does not inline a list head — list compaction wins', () => {
      const turtle = [
        '@prefix ex: <http://example.org/> .',
        '',
        'ex:s ex:p ( ex:a ex:b ) .',
        '',
      ].join('\n');
      const quads = new Parser({ format: 'text/turtle' }).parse(turtle);
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
      const ex = 'http://example.org/';
      const triples = [
        quad(namedNode(ex + 's'), namedNode(ex + 'p'), namedNode(ex + 'z')),
        quad(namedNode(ex + 's'), namedNode(ex + 'p'), namedNode(ex + 'a')),
        quad(namedNode(ex + 's'), namedNode(ex + 'p'), namedNode(ex + 'm')),
      ];
      const out = formatRdf(triples, 'turtle', { prefixes: { ex } });

      const aIdx = out.indexOf('ex:a');
      const mIdx = out.indexOf('ex:m');
      const zIdx = out.indexOf('ex:z');
      expect(aIdx).toBeGreaterThan(-1);
      expect(mIdx).toBeGreaterThan(-1);
      expect(zIdx).toBeGreaterThan(-1);
      expect(aIdx).toBeLessThan(mIdx);
      expect(mIdx).toBeLessThan(zIdx);
    });
  });

  describe('object-anchored predicates', () => {
    const SH = 'http://www.w3.org/ns/shacl#';
    const ex = 'http://example.org/';

    it('emits the anchored triple immediately before the object\'s description block', () => {
      const triples = [
        quad(
          namedNode(ex + 'NS'),
          namedNode(SH + 'property'),
          namedNode(ex + 'PropShape'),
        ),
        quad(
          namedNode(ex + 'NS'),
          namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
          namedNode(SH + 'NodeShape'),
        ),
        quad(
          namedNode(ex + 'PropShape'),
          namedNode(SH + 'path'),
          namedNode(ex + 'name'),
        ),
        quad(
          namedNode(ex + 'PropShape'),
          namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
          namedNode(SH + 'PropertyShape'),
        ),
      ];
      const out = formatRdf(triples, 'turtle', {
        prefixes: { ex, sh: SH },
        objectAnchoredPredicates: [SH + 'property'],
      });

      // The anchored triple is a standalone top-level triple — not inlined.
      expect(out).toMatch(/ex:NS\s+sh:property\s+ex:PropShape\s*\./);
      // Object keeps its own description block.
      expect(out).toMatch(/ex:PropShape\s+a\s+sh:PropertyShape/);
      // No `[…]` inlining of the property shape.
      expect(out).not.toMatch(/sh:property\s+\[/);
      // The anchored line precedes the object's block.
      const anchorIdx = out.search(/ex:NS\s+sh:property/);
      const blockIdx = out.search(/ex:PropShape\s+a/);
      expect(anchorIdx).toBeGreaterThan(-1);
      expect(blockIdx).toBeGreaterThan(-1);
      expect(anchorIdx).toBeLessThan(blockIdx);
    });

    it('accepts CURIEs in the predicate list when the prefix is configured', () => {
      const triples = [
        quad(
          namedNode(ex + 'NS'),
          namedNode(SH + 'property'),
          namedNode(ex + 'PropShape'),
        ),
        quad(
          namedNode(ex + 'PropShape'),
          namedNode(SH + 'path'),
          namedNode(ex + 'name'),
        ),
      ];
      const out = formatRdf(triples, 'turtle', {
        prefixes: { ex, sh: SH },
        objectAnchoredPredicates: ['sh:property'],
      });

      const anchorIdx = out.search(/ex:NS\s+sh:property\s+ex:PropShape/);
      const blockIdx = out.search(/ex:PropShape\s+sh:path/);
      expect(anchorIdx).toBeGreaterThan(-1);
      expect(blockIdx).toBeGreaterThan(-1);
      expect(anchorIdx).toBeLessThan(blockIdx);
    });

    it('does not anchor when the object is a blank node — falls back to default placement', () => {
      const b = DataFactory.blankNode('p');
      const triples = [
        quad(namedNode(ex + 'NS'), namedNode(SH + 'property'), b),
        quad(b, namedNode(SH + 'path'), namedNode(ex + 'name')),
      ];
      const out = formatRdf(triples, 'turtle', {
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
      // ex:A sh:property ex:B ; ex:B sh:property ex:C
      const triples = [
        quad(
          namedNode(ex + 'A'),
          namedNode(SH + 'property'),
          namedNode(ex + 'B'),
        ),
        quad(
          namedNode(ex + 'A'),
          namedNode(SH + 'targetClass'),
          namedNode(ex + 'X'),
        ),
        quad(
          namedNode(ex + 'B'),
          namedNode(SH + 'property'),
          namedNode(ex + 'C'),
        ),
        quad(namedNode(ex + 'B'), namedNode(SH + 'path'), namedNode(ex + 'p1')),
        quad(namedNode(ex + 'C'), namedNode(SH + 'path'), namedNode(ex + 'p2')),
      ];
      const out = formatRdf(triples, 'turtle', {
        prefixes: { ex, sh: SH },
        objectAnchoredPredicates: [SH + 'property'],
      });

      const aBlock = out.search(/ex:A\s+sh:targetClass/);
      const aProp = out.search(/ex:A\s+sh:property\s+ex:B/);
      const bBlock = out.search(/ex:B\s+sh:path/);
      const bProp = out.search(/ex:B\s+sh:property\s+ex:C/);
      const cBlock = out.search(/ex:C\s+sh:path/);
      expect(aBlock).toBeGreaterThan(-1);
      expect(aProp).toBeGreaterThan(-1);
      expect(bBlock).toBeGreaterThan(-1);
      expect(bProp).toBeGreaterThan(-1);
      expect(cBlock).toBeGreaterThan(-1);
      expect(aBlock).toBeLessThan(aProp);
      expect(aProp).toBeLessThan(bBlock);
      expect(bBlock).toBeLessThan(bProp);
      expect(bProp).toBeLessThan(cBlock);
    });

    it('groups multiple anchored references to the same object together, before the object\'s block', () => {
      const triples = [
        quad(
          namedNode(ex + 'NS1'),
          namedNode(SH + 'property'),
          namedNode(ex + 'PropShape'),
        ),
        quad(
          namedNode(ex + 'NS2'),
          namedNode(SH + 'property'),
          namedNode(ex + 'PropShape'),
        ),
        quad(
          namedNode(ex + 'PropShape'),
          namedNode(SH + 'path'),
          namedNode(ex + 'name'),
        ),
      ];
      const out = formatRdf(triples, 'turtle', {
        prefixes: { ex, sh: SH },
        objectAnchoredPredicates: [SH + 'property'],
      });

      const ns1 = out.search(/ex:NS1\s+sh:property\s+ex:PropShape/);
      const ns2 = out.search(/ex:NS2\s+sh:property\s+ex:PropShape/);
      const block = out.search(/ex:PropShape\s+sh:path/);
      expect(ns1).toBeGreaterThan(-1);
      expect(ns2).toBeGreaterThan(-1);
      expect(block).toBeGreaterThan(-1);
      expect(ns1).toBeLessThan(ns2);
      expect(ns2).toBeLessThan(block);

      // No duplication of the description.
      const matches = [...out.matchAll(/sh:path\s+ex:name/g)];
      expect(matches).toHaveLength(1);
    });
  });

  describe('@base handling', () => {
    it('emits @base and shortens matching absolute IRIs to relative form', () => {
      const out = formatRdf(
        [
          quad(
            namedNode('http://example.org/a'),
            namedNode('http://example.org/p'),
            namedNode('http://example.org/b'),
          ),
        ],
        'turtle',
        { prefixes: {}, base: 'http://example.org/' },
      );

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
      const original = [
        quad(
          namedNode('http://example.org/a'),
          namedNode('http://example.org/p'),
          namedNode('http://example.org/b'),
        ),
      ];
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

function parseBase(text: string): string | undefined {
  const match = text.match(/^@base\s+<([^>]+)>\s*\.$/m);
  return match ? match[1] : undefined;
}

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
