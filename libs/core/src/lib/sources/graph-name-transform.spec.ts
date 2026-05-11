import { DataFactory, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import {
  GRAPH_NAME_TRANSFORM,
  parseGraphNameTransform,
} from './graph-name-transform';
import type { RdfRecord } from '../engine';

const { namedNode, defaultGraph, quad } = DataFactory;

function ctxOf(perFile: Record<string, ReadonlyArray<RdfRecord>>) {
  return { perFileRecords: new Map(Object.entries(perFile)) };
}

function storeOf(records: ReadonlyArray<RdfRecord>): Store {
  const s = new Store();
  for (const r of records) s.addQuad(r.quad);
  return s;
}

describe('parseGraphNameTransform — shorthand', () => {
  it.each(['preserve', 'fillDefault', 'forceAll', 'flatten'] as const)(
    'parses shorthand %s into an apply function',
    (mode) => {
      const apply = parseGraphNameTransform(mode);
      expect(typeof apply).toBe('function');
    },
  );

  it('rejects a string that is not a known mode with a stable named error', () => {
    expect(() => parseGraphNameTransform('bogus')).toThrow(
      /graphName.*unknown mode "bogus".*preserve.*fillDefault.*forceAll.*flatten/,
    );
  });

  it('rejects a non-string non-object value with a stable named error', () => {
    expect(() => parseGraphNameTransform(42 as unknown)).toThrow(
      /graphName.*string.*object/,
    );
    expect(() => parseGraphNameTransform(null as unknown)).toThrow(
      /graphName.*string.*object/,
    );
    expect(() => parseGraphNameTransform([] as unknown)).toThrow(
      /graphName.*string.*object/,
    );
  });
});

describe('parseGraphNameTransform — long form', () => {
  it('parses { mode } long form for any mode', () => {
    const apply = parseGraphNameTransform({ mode: 'forceAll' });
    expect(typeof apply).toBe('function');
  });

  it('parses { mode, graph } for forceAll', () => {
    const apply = parseGraphNameTransform({
      mode: 'forceAll',
      graph: 'urn:my:graph',
    });
    expect(typeof apply).toBe('function');
  });

  it('parses { mode, graph } for fillDefault', () => {
    const apply = parseGraphNameTransform({
      mode: 'fillDefault',
      graph: 'urn:my:graph',
    });
    expect(typeof apply).toBe('function');
  });

  it('rejects { mode: preserve, graph } with a stable named error', () => {
    expect(() =>
      parseGraphNameTransform({ mode: 'preserve', graph: 'urn:g' }),
    ).toThrow(/graphName.*`graph`.*preserve.*forceAll.*fillDefault/);
  });

  it('rejects { mode: flatten, graph } with a stable named error', () => {
    expect(() =>
      parseGraphNameTransform({ mode: 'flatten', graph: 'urn:g' }),
    ).toThrow(/graphName.*`graph`.*flatten.*forceAll.*fillDefault/);
  });

  it('rejects long form missing mode', () => {
    expect(() =>
      parseGraphNameTransform({ graph: 'urn:g' } as unknown),
    ).toThrow(/graphName.*`mode`.*required/);
  });

  it('rejects long form with unknown mode', () => {
    expect(() =>
      parseGraphNameTransform({ mode: 'bogus' } as unknown),
    ).toThrow(/graphName.*unknown mode "bogus"/);
  });

  it('rejects long form with unknown extra keys', () => {
    expect(() =>
      parseGraphNameTransform({
        mode: 'forceAll',
        bogus: true,
      } as unknown),
    ).toThrow(/graphName.*unknown key.*bogus/);
  });
});

describe('graphName transform behaviour — preserve', () => {
  it('returns the input store unchanged (identity) for shorthand `preserve`', () => {
    const apply = parseGraphNameTransform('preserve');
    const r: RdfRecord = {
      quad: quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
    };
    const input = storeOf([r]);
    const out = apply(input, ctxOf({ '/file/a.ttl': [r] }));
    expect(out).toBe(input);
  });

  it('preserves declared named graphs from quad-format files', () => {
    const apply = parseGraphNameTransform('preserve');
    const declared = namedNode('http://example.org/g');
    const r: RdfRecord = {
      quad: quad(
        namedNode('urn:s'),
        namedNode('urn:p'),
        namedNode('urn:o'),
        declared,
      ),
    };
    const out = apply(storeOf([r]), ctxOf({ '/file/a.nq': [r] }));
    const [q] = out.getQuads(null, null, null, null);
    expect(q.graph.value).toBe('http://example.org/g');
  });
});

describe('graphName transform behaviour — flatten', () => {
  it('rewrites all named graphs to the default graph', () => {
    const apply = parseGraphNameTransform('flatten');
    const r1: RdfRecord = {
      quad: quad(
        namedNode('urn:s'),
        namedNode('urn:p'),
        namedNode('urn:o'),
        namedNode('http://example.org/g1'),
      ),
    };
    const r2: RdfRecord = {
      quad: quad(
        namedNode('urn:t'),
        namedNode('urn:p'),
        namedNode('urn:u'),
        namedNode('http://example.org/g2'),
      ),
    };
    const out = apply(storeOf([r1, r2]), ctxOf({ '/file/a.trig': [r1, r2] }));
    expect(out.size).toBe(2);
    for (const q of out.getQuads(null, null, null, null)) {
      expect(q.graph.termType).toBe('DefaultGraph');
    }
  });

  it('leaves default-graph quads in the default graph (idempotent)', () => {
    const apply = parseGraphNameTransform('flatten');
    const r: RdfRecord = {
      quad: quad(
        namedNode('urn:s'),
        namedNode('urn:p'),
        namedNode('urn:o'),
        defaultGraph(),
      ),
    };
    const out = apply(storeOf([r]), ctxOf({ '/file/a.ttl': [r] }));
    const [q] = out.getQuads(null, null, null, null);
    expect(q.graph.termType).toBe('DefaultGraph');
  });
});

describe('graphName transform behaviour — forceAll', () => {
  it('places triple-format default-graph quads in their own file:// graph', () => {
    const apply = parseGraphNameTransform('forceAll');
    const file = '/abs/a.ttl';
    const r: RdfRecord = {
      quad: quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
    };
    const out = apply(storeOf([r]), ctxOf({ [file]: [r] }));
    const [q] = out.getQuads(null, null, null, null);
    expect(q.graph.termType).toBe('NamedNode');
    expect(q.graph.value).toBe(`file://${file}`);
  });

  it('rewrites declared named graphs from quad-format files to file:// per file', () => {
    const apply = parseGraphNameTransform('forceAll');
    const file = '/abs/a.nq';
    const r: RdfRecord = {
      quad: quad(
        namedNode('urn:s'),
        namedNode('urn:p'),
        namedNode('urn:o'),
        namedNode('http://example.org/declared'),
      ),
    };
    const out = apply(storeOf([r]), ctxOf({ [file]: [r] }));
    const [q] = out.getQuads(null, null, null, null);
    expect(q.graph.value).toBe(`file://${file}`);
  });

  it('with override IRI rewrites every quad to that IRI', () => {
    const apply = parseGraphNameTransform({
      mode: 'forceAll',
      graph: 'urn:my:graph',
    });
    const fileA = '/abs/a.ttl';
    const fileB = '/abs/b.ttl';
    const rA: RdfRecord = {
      quad: quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
    };
    const rB: RdfRecord = {
      quad: quad(namedNode('urn:t'), namedNode('urn:p'), namedNode('urn:u')),
    };
    const out = apply(
      storeOf([rA, rB]),
      ctxOf({ [fileA]: [rA], [fileB]: [rB] }),
    );
    expect(out.size).toBe(2);
    for (const q of out.getQuads(null, null, null, null)) {
      expect(q.graph.value).toBe('urn:my:graph');
    }
  });
});

describe('graphName transform behaviour — fillDefault', () => {
  it('places triple-format default-graph quads in file://', () => {
    const apply = parseGraphNameTransform('fillDefault');
    const file = '/abs/a.ttl';
    const r: RdfRecord = {
      quad: quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
    };
    const out = apply(storeOf([r]), ctxOf({ [file]: [r] }));
    const [q] = out.getQuads(null, null, null, null);
    expect(q.graph.value).toBe(`file://${file}`);
  });

  it('preserves declared named graphs from quad-format files', () => {
    const apply = parseGraphNameTransform('fillDefault');
    const file = '/abs/a.nq';
    const r: RdfRecord = {
      quad: quad(
        namedNode('urn:s'),
        namedNode('urn:p'),
        namedNode('urn:o'),
        namedNode('http://example.org/g'),
      ),
    };
    const out = apply(storeOf([r]), ctxOf({ [file]: [r] }));
    const [q] = out.getQuads(null, null, null, null);
    expect(q.graph.value).toBe('http://example.org/g');
  });

  it('with override IRI substitutes the override for the synthetic file:// IRI', () => {
    const apply = parseGraphNameTransform({
      mode: 'fillDefault',
      graph: 'urn:my:graph',
    });
    const file = '/abs/a.ttl';
    const r: RdfRecord = {
      quad: quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
    };
    const out = apply(storeOf([r]), ctxOf({ [file]: [r] }));
    const [q] = out.getQuads(null, null, null, null);
    expect(q.graph.value).toBe('urn:my:graph');
  });
});

describe('GRAPH_NAME_TRANSFORM registry definition', () => {
  it('uses the key "graphName"', () => {
    expect(GRAPH_NAME_TRANSFORM.key).toBe('graphName');
  });

  it('parse() returns a TransformApply ready to run', () => {
    const apply = GRAPH_NAME_TRANSFORM.parse('preserve');
    expect(typeof apply).toBe('function');
  });
});
