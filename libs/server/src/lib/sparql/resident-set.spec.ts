import { describe, expect, it } from 'vitest';
import { ResidentSet } from './resident-set';

describe('ResidentSet', () => {
  it('evicts the least-recently-used entry when a set exceeds the quad budget', () => {
    const set = new ResidentSet<{ quads: number }>(3);

    expect(set.set('a', { quads: 2 })).toEqual([]);
    const evicted = set.set('b', { quads: 2 });

    expect(evicted).toEqual(['a']);
    expect(set.has('a')).toBe(false);
    expect(set.has('b')).toBe(true);
  });

  it('never evicts a pinned entry, skipping to the next least-recently-used', () => {
    const set = new ResidentSet<{ quads: number }>(3);
    set.set('a', { quads: 2 });
    set.set('b', { quads: 1 });
    set.pin('a');

    // 'a' is the LRU but pinned, so 'b' (next-LRU, idle) is evicted instead.
    const evicted = set.set('c', { quads: 2 });

    expect(evicted).toEqual(['b']);
    expect(set.has('a')).toBe(true);
    expect(set.has('c')).toBe(true);
  });

  it('refreshes recency on get, so the touched entry outlives the untouched one', () => {
    const set = new ResidentSet<{ quads: number }>(3);
    set.set('a', { quads: 1 });
    set.set('b', { quads: 1 });

    // Touch 'a' — now 'b' is the least-recently-used.
    expect(set.get('a')).toEqual({ quads: 1 });
    const evicted = set.set('c', { quads: 2 });

    expect(evicted).toEqual(['b']);
    expect(set.has('a')).toBe(true);
  });

  it('keeps the just-set entry resident even when it alone exceeds the budget', () => {
    const set = new ResidentSet<{ quads: number }>(3);
    const evicted = set.set('big', { quads: 10 });

    expect(evicted).toEqual([]);
    expect(set.has('big')).toBe(true);
  });
});
