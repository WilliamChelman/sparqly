import { DataFactory, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import {
  GRAPH_NAME_TRANSFORM,
  graphNameQuadRewriter,
  parseGraphNameTransformResult,
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

/** Parse a `graphName` spec and unwrap its apply fn (valid-spec helper). */
function applyOf(raw: unknown) {
  return parseGraphNameTransformResult(raw)._unsafeUnwrap().apply;
}

/** Assert a spec is rejected with a `graphName` transform-parse variant. */
function expectParseErr(raw: unknown, re: RegExp) {
  const result = parseGraphNameTransformResult(raw);
  expect(result.isErr()).toBe(true);
  if (!result.isErr()) throw new Error('unreachable');
  expect(result.error.kind).toBe('transform-parse');
  expect(result.error.transformKey).toBe('graphName');
  expect(result.error.message).toMatch(re);
}

describe('parseGraphNameTransformResult — shorthand', () => {
  it.each(['preserve', 'fillDefault', 'forceAll', 'flatten'] as const)(
    'parses shorthand %s into an apply function',
    (mode) => {
      expect(typeof applyOf(mode)).toBe('function');
    },
  );

  it('rejects a string that is not a known mode with a stable named error', () => {
    expectParseErr(
      'bogus',
      /graphName.*unknown mode "bogus".*preserve.*fillDefault.*forceAll.*flatten/,
    );
  });

  it('rejects a non-string non-object value with a stable named error', () => {
    expectParseErr(42 as unknown, /graphName.*string.*object/);
    expectParseErr(null as unknown, /graphName.*string.*object/);
    expectParseErr([] as unknown, /graphName.*string.*object/);
  });
});

describe('parseGraphNameTransformResult — long form', () => {
  it('parses { mode } long form for any mode', () => {
    expect(typeof applyOf({ mode: 'forceAll' })).toBe('function');
  });

  it('parses { mode, graph } for forceAll', () => {
    expect(
      typeof applyOf({ mode: 'forceAll', graph: 'urn:my:graph' }),
    ).toBe('function');
  });

  it('parses { mode, graph } for fillDefault', () => {
    expect(
      typeof applyOf({ mode: 'fillDefault', graph: 'urn:my:graph' }),
    ).toBe('function');
  });

  it('rejects { mode: preserve, graph } with a stable named error', () => {
    expectParseErr(
      { mode: 'preserve', graph: 'urn:g' },
      /graphName.*`graph`.*preserve.*forceAll.*fillDefault/,
    );
  });

  it('rejects { mode: flatten, graph } with a stable named error', () => {
    expectParseErr(
      { mode: 'flatten', graph: 'urn:g' },
      /graphName.*`graph`.*flatten.*forceAll.*fillDefault/,
    );
  });

  it('rejects long form missing mode', () => {
    expectParseErr({ graph: 'urn:g' } as unknown, /graphName.*`mode`.*required/);
  });

  it('rejects long form with unknown mode', () => {
    expectParseErr(
      { mode: 'bogus' } as unknown,
      /graphName.*unknown mode "bogus"/,
    );
  });

  it('rejects long form with unknown extra keys', () => {
    expectParseErr(
      { mode: 'forceAll', bogus: true } as unknown,
      /graphName.*unknown key.*bogus/,
    );
  });
});

describe('graphName transform behaviour — preserve', () => {
  it('returns the input store unchanged (identity) for shorthand `preserve`', () => {
    const apply = applyOf('preserve');
    const r: RdfRecord = {
      quad: quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
    };
    const input = storeOf([r]);
    const out = apply(input, ctxOf({ '/file/a.ttl': [r] }));
    expect(out).toBe(input);
  });

  it('preserves declared named graphs from quad-format files', () => {
    const apply = applyOf('preserve');
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
    const apply = applyOf('flatten');
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
    const apply = applyOf('flatten');
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
    const apply = applyOf('forceAll');
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
    const apply = applyOf('forceAll');
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
    const apply = applyOf({
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
    const apply = applyOf('fillDefault');
    const file = '/abs/a.ttl';
    const r: RdfRecord = {
      quad: quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
    };
    const out = apply(storeOf([r]), ctxOf({ [file]: [r] }));
    const [q] = out.getQuads(null, null, null, null);
    expect(q.graph.value).toBe(`file://${file}`);
  });

  it('preserves declared named graphs from quad-format files', () => {
    const apply = applyOf('fillDefault');
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
    const apply = applyOf({
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

describe('parseGraphNameTransformResult — Result-typed primary impl', () => {
  it('returns ok with an apply function for a valid shorthand mode', () => {
    const result = parseGraphNameTransformResult('forceAll');
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(typeof result.value.apply).toBe('function');
  });

  it('returns err with a transform-parse variant naming the transform key for an unknown mode', () => {
    const result = parseGraphNameTransformResult('bogus');
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('transform-parse');
    expect(result.error.transformKey).toBe('graphName');
    expect(result.error.message).toMatch(/unknown mode "bogus"/);
  });

  it('returns err with transform-parse for a non-string non-object value', () => {
    const result = parseGraphNameTransformResult(42 as unknown);
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('transform-parse');
    expect(result.error.transformKey).toBe('graphName');
  });

  it('returns err with transform-parse for long form missing mode', () => {
    const result = parseGraphNameTransformResult({ graph: 'urn:g' } as unknown);
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('transform-parse');
    expect(result.error.message).toMatch(/`mode`.*required/);
  });

  it('returns err with transform-parse for graph override on a mode that forbids it', () => {
    const result = parseGraphNameTransformResult({
      mode: 'preserve',
      graph: 'urn:g',
    });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('transform-parse');
    expect(result.error.message).toMatch(/`graph`.*preserve/);
  });
});

describe('parseGraphNameTransformResult — config for index staleness (ADR-0041)', () => {
  it('exposes the parsed mode as config for a shorthand mode', () => {
    const result = parseGraphNameTransformResult('forceAll');
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    // The config feeds the Glob index manifest — a mode change must register
    // as staleness, so the manifest needs the mode itself, not just the key.
    expect(result.value.config).toEqual({ mode: 'forceAll' });
  });

  it('exposes the mode and graph override as config for the long form', () => {
    const result = parseGraphNameTransformResult({
      mode: 'forceAll',
      graph: 'http://example.org/g',
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.config).toEqual({
      mode: 'forceAll',
      graph: 'http://example.org/g',
    });
  });

  it('omits `graph` from config when no override is declared', () => {
    const result = parseGraphNameTransformResult({ mode: 'fillDefault' });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.config).toEqual({ mode: 'fillDefault' });
  });
});

describe('graphNameQuadRewriter — per-quad rewrite for the streamed ingest (#348)', () => {
  it('forceAll with an override IRI rewrites a quad into that graph', () => {
    const rewrite = graphNameQuadRewriter(
      { mode: 'forceAll', graph: 'urn:my:graph' },
      '/abs/a.ttl',
    );
    const out = rewrite(
      quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
    );
    expect(out.graph.termType).toBe('NamedNode');
    expect(out.graph.value).toBe('urn:my:graph');
  });

  it('forceAll without an override rewrites every quad into the file:// graph', () => {
    const rewrite = graphNameQuadRewriter({ mode: 'forceAll' }, '/abs/a.nq');
    const fromDefault = rewrite(
      quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
    );
    const fromNamed = rewrite(
      quad(
        namedNode('urn:t'),
        namedNode('urn:p'),
        namedNode('urn:u'),
        namedNode('http://example.org/declared'),
      ),
    );
    expect(fromDefault.graph.value).toBe('file:///abs/a.nq');
    expect(fromNamed.graph.value).toBe('file:///abs/a.nq');
  });

  it('fillDefault rewrites only default-graph quads, leaving named graphs intact', () => {
    const rewrite = graphNameQuadRewriter({ mode: 'fillDefault' }, '/abs/a.nq');
    const fromDefault = rewrite(
      quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
    );
    const fromNamed = rewrite(
      quad(
        namedNode('urn:t'),
        namedNode('urn:p'),
        namedNode('urn:u'),
        namedNode('http://example.org/declared'),
      ),
    );
    expect(fromDefault.graph.value).toBe('file:///abs/a.nq');
    expect(fromNamed.graph.value).toBe('http://example.org/declared');
  });

  it('flatten rewrites every quad into the default graph', () => {
    const rewrite = graphNameQuadRewriter({ mode: 'flatten' }, '/abs/a.trig');
    const fromNamed = rewrite(
      quad(
        namedNode('urn:s'),
        namedNode('urn:p'),
        namedNode('urn:o'),
        namedNode('http://example.org/g'),
      ),
    );
    const fromDefault = rewrite(
      quad(namedNode('urn:t'), namedNode('urn:p'), namedNode('urn:u')),
    );
    expect(fromNamed.graph.termType).toBe('DefaultGraph');
    expect(fromDefault.graph.termType).toBe('DefaultGraph');
  });

  it('preserve returns each quad unchanged', () => {
    const rewrite = graphNameQuadRewriter({ mode: 'preserve' }, '/abs/a.nq');
    const original = quad(
      namedNode('urn:s'),
      namedNode('urn:p'),
      namedNode('urn:o'),
      namedNode('http://example.org/g'),
    );
    expect(rewrite(original)).toBe(original);
  });
});

describe('GRAPH_NAME_TRANSFORM registry definition', () => {
  it('uses the key "graphName"', () => {
    expect(GRAPH_NAME_TRANSFORM.key).toBe('graphName');
  });

  it('parse() returns a ParsedTransformResult carrying the apply fn and config', () => {
    const parsed = GRAPH_NAME_TRANSFORM.parse('preserve');
    if (typeof parsed === 'function') {
      throw new Error('expected a ParsedTransformResult, not a bare apply fn');
    }
    expect(typeof parsed.apply).toBe('function');
    // The registry path threads config through `parseTransformList`, so a
    // declared `graphName` lands in the Glob index manifest (ADR-0041).
    expect(parsed.config).toEqual({ mode: 'preserve' });
  });
});
