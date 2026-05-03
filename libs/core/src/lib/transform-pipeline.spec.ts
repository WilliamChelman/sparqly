import { describe, expect, it } from 'vitest';
import { DataFactory, Store } from 'n3';
import { applyTransformPipeline } from './transform-pipeline';
import type { ParsedTransform } from './transform-spec';

const { namedNode, quad } = DataFactory;

function storeWith(...quads: ReturnType<typeof quad>[]): Store {
  const s = new Store();
  for (const q of quads) s.addQuad(q);
  return s;
}

describe('applyTransformPipeline', () => {
  it('returns the input store unchanged when the pipeline is empty (identity)', () => {
    const input = storeWith(
      quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
    );
    const out = applyTransformPipeline(input, []);
    expect(out).toBe(input);
    expect(out.size).toBe(1);
  });

  it('applies a single transform and returns its result', () => {
    const tagP = namedNode('urn:tag');
    const stub: ParsedTransform = {
      key: 'addTag',
      apply: (store) => {
        const next = new Store([...store]);
        next.addQuad(
          quad(namedNode('urn:s'), tagP, namedNode('urn:o-tagged')),
        );
        return next;
      },
    };
    const input = storeWith(
      quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
    );
    const out = applyTransformPipeline(input, [stub]);
    expect(out.size).toBe(2);
    expect(out.getQuads(null, tagP, null, null)).toHaveLength(1);
  });

  it('composes two transforms left-to-right (array order)', () => {
    const order: string[] = [];
    const a: ParsedTransform = {
      key: 'a',
      apply: (s) => {
        order.push('a');
        const next = new Store([...s]);
        next.addQuad(quad(namedNode('urn:x'), namedNode('urn:p'), namedNode('urn:a')));
        return next;
      },
    };
    const b: ParsedTransform = {
      key: 'b',
      apply: (s) => {
        order.push('b');
        // b only runs after a — assert that a's quad is visible here
        expect(s.getQuads(namedNode('urn:x'), null, null, null)).toHaveLength(1);
        const next = new Store([...s]);
        next.addQuad(quad(namedNode('urn:y'), namedNode('urn:p'), namedNode('urn:b')));
        return next;
      },
    };
    const out = applyTransformPipeline(new Store(), [a, b]);
    expect(order).toEqual(['a', 'b']);
    expect(out.size).toBe(2);
  });

  it('threads the optional TransformContext to each transform unchanged', () => {
    const seen: unknown[] = [];
    const inspect: ParsedTransform = {
      key: 'inspect',
      apply: (s, ctx) => {
        seen.push(ctx);
        return s;
      },
    };
    const ctx = { perFileRecords: new Map() };
    applyTransformPipeline(new Store(), [inspect, inspect], ctx);
    expect(seen).toEqual([ctx, ctx]);
  });

  it('does not mutate the original input store, even when a transform returns a fresh Store', () => {
    const input = storeWith(
      quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
    );
    const sizeBefore = input.size;
    const stub: ParsedTransform = {
      key: 'fresh',
      apply: () => {
        const fresh = new Store();
        fresh.addQuad(
          quad(namedNode('urn:other'), namedNode('urn:p'), namedNode('urn:o')),
        );
        return fresh;
      },
    };
    applyTransformPipeline(input, [stub]);
    expect(input.size).toBe(sizeBefore);
    expect(input.getQuads(namedNode('urn:other'), null, null, null)).toHaveLength(0);
  });
});
