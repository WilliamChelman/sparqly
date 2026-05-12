import { describe, expect, it } from 'vitest';
import { buildPathExpansionQuery } from './build-path-expansion-query';

const SEED = 'http://example.org/alice';
const P1 = 'http://example.org/list';
const P2 = 'http://example.org/about';
const P3 = 'http://example.org/next';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('buildPathExpansionQuery (ADR-0019, ADR-0023)', () => {
  it('is a SELECT projecting the terminal node and both edge trios', () => {
    const q = buildPathExpansionQuery(SEED, [{ predicate: P1, inverse: false }]);
    expect(q.startsWith('SELECT')).toBe(true);
    for (const v of ['?node', '?eop', '?eoo', '?eg', '?eis', '?eip', '?eig']) {
      expect(q).toContain(v);
    }
  });

  it('emits the terminal node in both directions, each branch graph-aware', () => {
    const q = buildPathExpansionQuery(SEED, []);
    // outgoing: a plain and a GRAPH-wrapped form over ?node as subject
    expect(q).toMatch(/\{\s*\?node\s+\?eop\s+\?eoo\s*\}/);
    expect(q).toMatch(/GRAPH\s+\?eg\s*\{\s*\?node\s+\?eop\s+\?eoo\s*\}/);
    // incoming: a plain and a GRAPH-wrapped form over ?node as object
    expect(q).toMatch(/\{\s*\?eis\s+\?eip\s+\?node\s*\}/);
    expect(q).toMatch(/GRAPH\s+\?eig\s*\{\s*\?eis\s+\?eip\s+\?node\s*\}/);
  });

  it('degenerates to the seed quads in both directions for the empty path', () => {
    const q = buildPathExpansionQuery(SEED, []);
    // no hops walked, so no blank-node filtering
    expect(q).not.toMatch(/isBlank/i);
    // the seed is bound to the terminal variable
    expect(
      new RegExp(`BIND\\(\\s*<${escapeRegExp(SEED)}>\\s+AS\\s+\\?node\\s*\\)`).test(q),
    ).toBe(true);
  });

  it('walks a single forward step, pins its predicate, and filters to a blank node', () => {
    const q = buildPathExpansionQuery(SEED, [{ predicate: P1, inverse: false }]);
    // hop pattern: <seed> <p1> ?node
    expect(
      new RegExp(`<${escapeRegExp(SEED)}>\\s+<${escapeRegExp(P1)}>\\s+\\?node`).test(q),
    ).toBe(true);
    expect(q).toMatch(/FILTER\(\s*isBlank\(\s*\?node\s*\)\s*\)/i);
    // exactly one isBlank filter for one hop, and no BIND degeneracy
    expect(q.match(/isBlank/gi)).toHaveLength(1);
    expect(q).not.toMatch(/BIND/);
  });

  it('walks a single inverse step with the seed in the object slot of the hop', () => {
    const q = buildPathExpansionQuery(SEED, [{ predicate: P2, inverse: true }]);
    // hop pattern: ?node <p2> <seed>  (the seed is the object of the pinned hop)
    expect(
      new RegExp(`\\?node\\s+<${escapeRegExp(P2)}>\\s+<${escapeRegExp(SEED)}>`).test(q),
    ).toBe(true);
    expect(
      new RegExp(`<${escapeRegExp(SEED)}>\\s+<${escapeRegExp(P2)}>`).test(q),
    ).toBe(false);
    expect(q).toMatch(/FILTER\(\s*isBlank\(\s*\?node\s*\)\s*\)/i);
  });

  it('walks a multi-step mixed-direction path: every predicate pinned, one isBlank per hop', () => {
    const q = buildPathExpansionQuery(SEED, [
      { predicate: P1, inverse: false },
      { predicate: P2, inverse: true },
      { predicate: P3, inverse: false },
    ]);
    for (const p of [P1, P2, P3]) {
      expect(q).toContain(`<${p}>`);
    }
    expect(q.match(/isBlank/gi)).toHaveLength(3);
    // first hop is forward from the seed
    expect(
      new RegExp(`<${escapeRegExp(SEED)}>\\s+<${escapeRegExp(P1)}>\\s+\\?\\w+`).test(q),
    ).toBe(true);
    // the terminal hop binds ?node
    expect(
      new RegExp(`<${escapeRegExp(P3)}>\\s+\\?node`).test(q),
    ).toBe(true);
  });
});
