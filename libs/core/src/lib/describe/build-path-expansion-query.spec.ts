import { describe, expect, it } from 'vitest';
import { buildPathExpansionQuery } from './build-path-expansion-query';

const SEED = 'http://example.org/alice';
const P1 = 'http://example.org/list';
const P2 = 'http://example.org/about';
const P3 = 'http://example.org/next';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Triple pattern with `iri` in the subject slot: `<iri> ?x ?y`. */
function emitsAsSubject(query: string, iri: string): boolean {
  return new RegExp(`<${escapeRegExp(iri)}>\\s+\\?\\w+\\s+\\?\\w+`).test(query);
}

/** Triple pattern with `iri` in the object slot: `?x ?y <iri>`. */
function emitsAsObject(query: string, iri: string): boolean {
  return new RegExp(`\\?\\w+\\s+\\?\\w+\\s+<${escapeRegExp(iri)}>`).test(query);
}

describe('buildPathExpansionQuery (ADR-0019)', () => {
  it('degenerates to the seed quads in both directions for the empty path', () => {
    const q = buildPathExpansionQuery(SEED, []);
    expect(q.startsWith('CONSTRUCT')).toBe(true);
    expect(emitsAsSubject(q, SEED)).toBe(true);
    expect(emitsAsObject(q, SEED)).toBe(true);
    // no hops walked, so no blank-node filtering
    expect(q).not.toMatch(/isBlank/i);
  });

  it('walks a single forward step, pins its predicate, and filters to a blank node', () => {
    const q = buildPathExpansionQuery(SEED, [{ predicate: P1, inverse: false }]);
    // hop pattern: <seed> <p1> ?m1
    expect(
      new RegExp(`<${escapeRegExp(SEED)}>\\s+<${escapeRegExp(P1)}>\\s+\\?\\w+`).test(q),
    ).toBe(true);
    // the hop target is required to be a blank node
    expect(q).toMatch(/FILTER\(\s*isBlank\(\s*\?\w+\s*\)\s*\)/i);
    // the terminal (the hop target, not the seed) is emitted in both directions
    expect(emitsAsSubject(q, SEED)).toBe(false);
    expect(emitsAsObject(q, SEED)).toBe(false);
    // exactly one isBlank filter for one hop
    expect(q.match(/isBlank/gi)).toHaveLength(1);
  });

  it('walks a single inverse step with the seed in the object slot of the hop', () => {
    const q = buildPathExpansionQuery(SEED, [{ predicate: P2, inverse: true }]);
    // hop pattern: ?m1 <p2> <seed>  (the seed is the object of the pinned hop)
    expect(
      new RegExp(`\\?\\w+\\s+<${escapeRegExp(P2)}>\\s+<${escapeRegExp(SEED)}>`).test(q),
    ).toBe(true);
    // not the forward shape
    expect(
      new RegExp(`<${escapeRegExp(SEED)}>\\s+<${escapeRegExp(P2)}>`).test(q),
    ).toBe(false);
    expect(q).toMatch(/FILTER\(\s*isBlank\(\s*\?\w+\s*\)\s*\)/i);
  });

  it('walks a multi-step mixed-direction path: every predicate pinned, one isBlank per hop', () => {
    const q = buildPathExpansionQuery(SEED, [
      { predicate: P1, inverse: false },
      { predicate: P2, inverse: true },
      { predicate: P3, inverse: false },
    ]);
    // every path predicate appears pinned
    for (const p of [P1, P2, P3]) {
      expect(q).toContain(`<${p}>`);
    }
    // one blank-node filter per hop
    expect(q.match(/isBlank/gi)).toHaveLength(3);
    // first hop is forward from the seed
    expect(
      new RegExp(`<${escapeRegExp(SEED)}>\\s+<${escapeRegExp(P1)}>\\s+\\?\\w+`).test(q),
    ).toBe(true);
    // the seed is never re-emitted — the terminal is the third hop's node
    expect(emitsAsSubject(q, SEED)).toBe(false);
    expect(emitsAsObject(q, SEED)).toBe(false);
    // terminal emitted in both directions: a var-var-var outgoing triple and a
    // var-var-var incoming triple over the same terminal variable exist in the
    // CONSTRUCT template
    expect(q).toMatch(/CONSTRUCT\s*\{\s*\?\w+\s+\?\w+\s+\?\w+\s*\.\s*\?\w+\s+\?\w+\s+\?\w+\s*\}/);
  });
});
